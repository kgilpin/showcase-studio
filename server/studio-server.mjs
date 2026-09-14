/* The studio server: every Showcase Studio feature, in plain Node.
 *
 * createStudio() returns one request handler, handle(req, res, next),
 * that any Node HTTP server can mount — the Vite dev server in the dev
 * modes (scripts/dev.mjs) and the packaged app's own server
 * (electron/main.mjs). The page, the Electron window, and Claude are all
 * clients of it:
 *
 *   GET  /showcase-data/…       the library's files, for the page
 *                               (server/showcase-data.mjs)
 *   GET  /studio/api/info       the studio: URL, library folder, lock, features
 *   GET  /studio/api/events     live events (server-sent events): reload,
 *                               info, export, terminal-data, terminal-exit
 *   POST /studio/api/<action>   page actions, JSON in and out (ACTIONS below)
 *   POST /mcp                   the MCP tools, for Claude (server/mcp.mjs)
 *
 * The API, events, and MCP write files and start terminals, so they only
 * answer requests made on this machine.
 *
 * The studio also keeps its library folder scaffolded (README, CLAUDE.md,
 * .studio/GUIDE.md, .studio/mcp.json), watches it and tells pages to
 * reload when files change outside the studio, and lists itself in the
 * studio data folder (running/<pid>.json) so the MCP bridge
 * (server/mcp-stdio.mjs) can find it without knowing its port. */
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { createExportJobs } from "./export-jobs.mjs";
import { runExport } from "./exporter.mjs";
import { EXPORT_KINDS } from "./launch-options.mjs";
import { createMcpHandler } from "./mcp.mjs";
import { prompterScript } from "./prompter-script.mjs";
import { applySceneEditToFolder, contentHash } from "./scene-edit.mjs";
import { handleShowcaseRequest } from "./showcase-data.mjs";
import { hasStaleInlineGuide, studioGuide } from "./showcase-guide.mjs";
import { loadSettings, saveSettings, studioDataDir } from "./settings.mjs";
import { createTerminals } from "./terminals.mjs";
import { whisperPath } from "./transcribe.mjs";

const require_ = createRequire(import.meta.url);
let ffmpegPath;
try {
  ffmpegPath = require_("ffmpeg-static");
} catch {
  /* exports degrade too; the guide says "(unavailable)" */
}

const FOLDER_README = `# Showcases

This folder is managed by Showcase Studio. Each showcase is a folder:

    <id>/showcase.yaml   the script: scenes, narration, timing
    <id>/theme.yaml      optional styling (colors, fonts, atmosphere)
    <id>/assets/         screenshots and marks (asset keys = file names without extension)
    <id>/graphics/       optional TSX diagrams (default-export React components, CSS-only animation)

A showcase.yaml at this top level (next to the showcase folders) holds
library settings — currently just one:

    show_in_recent: false   keep this folder out of File > Open Recent

The studio live-reloads whenever files here change. The folder is yours
to version: run \`git init\` here and commit as you like — the app never
runs git itself, and switching branches reloads the app automatically.
`;

/* New folders start with scaffolding only — no sample showcases; the
 * samples live in the app repo, and the "+" card creates real content.
 *
 * Two ownership rules keep instructions current without clobbering the
 * user: CLAUDE.md and README are seeded once and then belong to the
 * user; .studio/GUIDE.md belongs to the studio and is rewritten on every
 * start (and library switch), so any Claude Code session here — embedded,
 * external, or user-started — always sees instructions that match the
 * running app. The seeded CLAUDE.md pulls the guide in via Claude Code's
 * @-import; folders seeded before the split get the import line (and the
 * .gitignore entry) appended once. */
const GUIDE_IMPORT = "@.studio/GUIDE.md";

const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

const hostnameOf = (host) =>
  String(host ?? "")
    .toLowerCase()
    .replace(/:\d+$/, "");

/** True for a request made on this machine to a local host name. The
 *  address check keeps other machines out; the Host and Origin checks
 *  keep web pages from other sites (DNS rebinding, cross-site POSTs) out. */
export function isLocalRequest(req) {
  if (!LOOPBACK_ADDRESSES.has(req.socket?.remoteAddress ?? "")) return false;
  if (!LOCAL_HOSTNAMES.has(hostnameOf(req.headers.host))) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return LOCAL_HOSTNAMES.has(new URL(origin).host.toLowerCase().replace(/:\d+$/, ""));
  } catch {
    return false;
  }
}

const isDirectory = (dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** A file or folder name the page may name: no separators, no "..". */
const badName = (s) => !s || s.includes("/") || s.includes("\\") || s.includes("..");

const sendJson = (res, status, value) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(value));
};

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body.trim() ? JSON.parse(body) : {};
}

/**
 * Creates a studio for one library folder.
 *
 *   showcasesDir  the library
 *   lock          { kind: "showcase", showcaseId } | { kind: "new" } | null
 *   version       the app version (reported in info and MCP)
 *   srcDir        the studio app's source, for the guide and terminals
 *   renderer      draws pages for screenshots and exports (optional)
 *   features      { terminal: false } turns the embedded terminals off
 *   exportDir     where exports land (<exportDir>/<showcase id>)
 *   settings      { load, save } — the persisted settings
 *   registryDir   where running studios list themselves
 */
export function createStudio({
  showcasesDir: initialDir,
  lock: initialLock = null,
  version,
  srcDir,
  renderer,
  features = {},
  exportDir = path.join(os.homedir(), "Downloads", "showcase-exports"),
  settings = { load: loadSettings, save: saveSettings },
  registryDir = path.join(studioDataDir(), "running"),
  log = (message) => console.log(message),
}) {
  let showcasesDir = path.resolve(initialDir);
  let lock = initialLock;
  let url = null;
  const startedAt = new Date().toISOString();
  const terminalsOn = features.terminal !== false;

  /* ---------- live events ---------- */

  const listeners = new Set();
  const emit = (event, data) => {
    const chunk = `event: ${event}\ndata: ${JSON.stringify(data ?? {})}\n\n`;
    for (const res of listeners) res.write(chunk);
  };

  const info = () => ({
    version,
    url,
    library: showcasesDir,
    lock,
    features: { terminal: terminalsOn },
    pid: process.pid,
    startedAt,
  });

  /* ---------- the library folder ---------- */

  function scaffold() {
    mkdirSync(path.join(showcasesDir, ".studio"), { recursive: true });
    const claudeMdPath = path.join(showcasesDir, "CLAUDE.md");
    const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf8") : null;
    writeFileSync(
      path.join(showcasesDir, ".studio", "GUIDE.md"),
      studioGuide({
        version,
        srcDir,
        ffmpegPath,
        showcasesDir,
        staleClaudeMd: claudeMd != null && hasStaleInlineGuide(claudeMd),
      }),
    );
    writeMcpConfig();
    if (!existsSync(path.join(showcasesDir, "README.md"))) {
      writeFileSync(path.join(showcasesDir, "README.md"), FOLDER_README);
    }
    const gitignorePath = path.join(showcasesDir, ".gitignore");
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, ".DS_Store\n.studio/\n");
    } else if (!readFileSync(gitignorePath, "utf8").includes(".studio/")) {
      appendFileSync(gitignorePath, ".studio/\n");
    }
    if (claudeMd == null) {
      writeFileSync(
        claudeMdPath,
        `# Showcases folder

${GUIDE_IMPORT}

The line above imports the studio's always-current instructions
(regenerated on every launch — keep it). The rest of this file is yours:
add notes specific to this library below, and the studio won't touch them.
`,
      );
    } else if (!claudeMd.includes(GUIDE_IMPORT)) {
      appendFileSync(
        claudeMdPath,
        `\n${GUIDE_IMPORT}\n<!-- The studio's always-current instructions (regenerated every launch) — keep this import. -->\n`,
      );
    }
  }

  /* The studio's MCP tools at this studio's URL; embedded terminals load
   * this via --mcp-config, and a user-started `claude` can point at it. */
  function writeMcpConfig() {
    if (!url) return;
    writeFileSync(
      path.join(showcasesDir, ".studio", "mcp.json"),
      JSON.stringify(
        { mcpServers: { "showcase-studio": { type: "http", url: `${url}/mcp` } } },
        null,
        2,
      ) + "\n",
    );
  }

  /* ---------- watching for outside changes ---------- */

  /* In-app edits are already applied to the page's model, so their file
   * writes must not come back as a full page reload (the "flash"). Each
   * such write records the content hash it produced; when every file in a
   * change burst still matches its recorded hash, the burst is the echo of
   * our own writes and is swallowed. Anything else — Claude's edits, hand
   * edits, git checkouts — reloads the pages. */
  const selfWrites = new Map();
  const recordSelfWrite = (file, content) =>
    selfWrites.set(file, { hash: contentHash(content), at: Date.now() });
  const isSelfWriteEcho = (file) => {
    const entry = selfWrites.get(file);
    if (!entry || Date.now() - entry.at > 10_000) return false;
    try {
      return contentHash(readFileSync(file)) === entry.hash;
    } catch {
      return false;
    }
  };

  let watcher;
  function watchLibrary() {
    watcher?.close();
    let timer;
    const pending = new Set();
    try {
      watcher = watch(showcasesDir, { recursive: true }, (_event, filename) => {
        /* The studio's own bookkeeping never changes what pages show. */
        if (filename != null && /^(\.studio|\.git)([/\\]|$)/.test(filename)) return;
        pending.add(filename == null ? null : path.join(showcasesDir, filename));
        clearTimeout(timer);
        timer = setTimeout(() => {
          const changed = [...pending];
          pending.clear();
          if (changed.every((file) => file != null && isSelfWriteEcho(file))) return;
          emit("reload", {});
        }, 250);
      });
    } catch (error) {
      log(`studio: not watching ${showcasesDir} (${error.message})`);
    }
  }

  /* ---------- finding a running studio ---------- */

  const registryFile = path.join(registryDir, `${process.pid}.json`);
  function register() {
    if (!url) return;
    mkdirSync(registryDir, { recursive: true });
    writeFileSync(registryFile, JSON.stringify(info(), null, 2) + "\n");
  }

  /* ---------- exports ---------- */

  const exportJobs = createExportJobs(async (kind, showcaseId, { onProgress, signal }) => {
    const progress = (label) => {
      onProgress(label);
      emit("export", { showcaseId, kind, label });
    };
    try {
      const out = await runExport({
        renderer,
        appUrl: url,
        showcasesDir,
        kind,
        showcaseId,
        outDir: path.join(exportDir, showcaseId),
        onProgress: progress,
        signal,
      });
      emit("export", { showcaseId, kind, label: "done", done: true, out });
      return out;
    } catch (error) {
      emit("export", {
        showcaseId,
        kind,
        label: "failed",
        done: true,
        error: String(error?.message ?? error),
      });
      throw error;
    }
  });

  /* ---------- terminals and MCP ---------- */

  const terminals = terminalsOn
    ? createTerminals({
        getLibrary: () => showcasesDir,
        /* Facts every Claude session should have on hand, computed at
         * spawn so they track the running studio. .studio/GUIDE.md
         * explains each one. */
        getEnv: () => ({
          SHOWCASE_STUDIO_ROOT: showcasesDir,
          SHOWCASE_STUDIO_SRC: srcDir,
          ...(ffmpegPath ? { SHOWCASE_STUDIO_FFMPEG: ffmpegPath } : {}),
          ...(whisperPath() ? { SHOWCASE_STUDIO_WHISPER: whisperPath() } : {}),
        }),
        getMcpConfig: () => path.join(showcasesDir, ".studio", "mcp.json"),
        settings,
        emit,
      })
    : null;

  const mcp = createMcpHandler({
    version,
    context: {
      info,
      getUrl: () => url,
      getShowcasesDir: () => showcasesDir,
      renderer,
      exportJobs,
    },
  });

  /* ---------- page actions ---------- */

  /** Scaffolds a new showcase folder (the "+" card and the /new page). */
  function createShowcase(name) {
    /* Creating opens the new showcase, which would leave this one. */
    if (lock?.kind === "showcase") {
      return { ok: false, error: "This studio is locked to one showcase" };
    }
    const title = String(name ?? "").trim();
    const id = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!id) return { ok: false, error: "Give the showcase a name" };
    if (existsSync(path.join(showcasesDir, id))) {
      return { ok: false, error: `A showcase named "${id}" already exists` };
    }
    mkdirSync(path.join(showcasesDir, id, "assets"), { recursive: true });
    writeFileSync(
      path.join(showcasesDir, id, "showcase.yaml"),
      `meta:
  title: ${title}
  description: Describe ${title} in a sentence.
  loop: true

scenes:
  - id: intro
    theme: statement
    title: ${title}
    captions:
      - text: Replace this narration with your opening line.
    media:
      kind: none
`,
    );
    /* A --new studio is now locked to the showcase it created. */
    if (lock?.kind === "new") {
      lock = { kind: "showcase", showcaseId: id };
      register();
      emit("info", info());
    }
    return { ok: true, id };
  }

  /* Renames an asset file and updates every YAML reference to it — the
   * bare key and the full file name, in asset:/src:/cover: fields only,
   * so narration text mentioning the same word is left alone. */
  function renameAsset({ showcaseId, from, to } = {}) {
    const id = String(showcaseId ?? "");
    const oldName = String(from ?? "");
    if (badName(id) || badName(oldName)) return { ok: false, error: "Bad name" };
    let newName = String(to ?? "").trim();
    if (!newName) return { ok: false, error: "Give the asset a name" };
    if (!path.extname(newName)) newName += path.extname(oldName);
    if (badName(newName)) return { ok: false, error: "Bad name" };
    const dir = path.join(showcasesDir, id, "assets");
    if (!existsSync(path.join(dir, oldName))) {
      return { ok: false, error: `No file named "${oldName}" in ${id}/assets` };
    }
    if (newName !== oldName && existsSync(path.join(dir, newName))) {
      return { ok: false, error: `"${newName}" already exists` };
    }
    let updatedReferences = 0;
    const yamlPath = path.join(showcasesDir, id, "showcase.yaml");
    if (existsSync(yamlPath)) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const strip = (s) => s.replace(/\.[^.]+$/, "");
      let text = readFileSync(yamlPath, "utf8");
      const renames = [[oldName, newName]];
      if (strip(oldName) !== oldName) renames.push([strip(oldName), strip(newName)]);
      for (const [o, n] of renames) {
        const re = new RegExp(
          `(^\\s*(?:asset|src|cover):\\s*["']?)${esc(o)}(["']?\\s*(?:#.*)?)$`,
          "gm",
        );
        text = text.replace(re, (_all, head, tail) => {
          updatedReferences += 1;
          return `${head}${n}${tail}`;
        });
      }
      if (updatedReferences > 0) writeFileSync(yamlPath, text);
    }
    renameSync(path.join(dir, oldName), path.join(dir, newName));
    return { ok: true, name: newName, updatedReferences };
  }

  /* Adds files to the showcase's assets/ folder — the drop target on the
   * assets page. All files arrive in one request (base64) and are all
   * written before the watcher's reload can interrupt; names are
   * de-duplicated (name-2.png), never overwritten. */
  function addAssets({ showcaseId, files } = {}) {
    const id = String(showcaseId ?? "");
    if (badName(id)) return { ok: false, error: "Bad showcase id" };
    if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "No files" };
    if (!existsSync(path.join(showcasesDir, id))) {
      return { ok: false, error: `No showcase named "${id}"` };
    }
    const dir = path.join(showcasesDir, id, "assets");
    mkdirSync(dir, { recursive: true });
    const written = [];
    for (const file of files) {
      const name = String(file?.name ?? "").trim();
      if (badName(name)) return { ok: false, error: `Bad file name "${name}"` };
      if (typeof file?.data !== "string" || !file.data) {
        return { ok: false, error: `No data for "${name}"` };
      }
      const ext = path.extname(name);
      const stem = name.slice(0, name.length - ext.length);
      let candidate = name;
      for (let n = 2; existsSync(path.join(dir, candidate)); n += 1) {
        candidate = `${stem}-${n}${ext}`;
      }
      writeFileSync(path.join(dir, candidate), Buffer.from(file.data, "base64"));
      written.push(candidate);
    }
    return { ok: true, names: written };
  }

  /* Deletes one asset file (the page confirms first). YAML references are
   * left alone — a dangling key shows up in the assets page's "referenced
   * but missing" list, which is the honest state. */
  function deleteAsset({ showcaseId, name } = {}) {
    const id = String(showcaseId ?? "");
    const fileName = String(name ?? "");
    if (badName(id) || badName(fileName)) return { ok: false, error: "Bad name" };
    const file = path.join(showcasesDir, id, "assets", fileName);
    if (!existsSync(file)) {
      return { ok: false, error: `No file named "${fileName}" in ${id}/assets` };
    }
    unlinkSync(file);
    return { ok: true };
  }

  /* Shares a showcase's script as a phone teleprompter: derives the
   * snapshot (server/prompter-script.mjs) and POSTs it to the prompter
   * site's publish endpoint (cdk/). The token — the capability in the URL
   * — is generated once per showcase and remembered, so publishing again
   * updates the same link the narrator already has. Configure with
   * prompterPublishUrl / prompterPublishKey in settings.json (or the
   * PROMPTER_PUBLISH_URL / PROMPTER_PUBLISH_KEY secrets in the
   * environment). */
  async function publishPrompter({ showcaseId } = {}) {
    const id = String(showcaseId ?? "");
    if (badName(id)) return { ok: false, error: "Bad showcase id" };
    const saved = settings.load();
    const publishUrl = process.env.PROMPTER_PUBLISH_URL ?? saved.prompterPublishUrl;
    const publishKey = process.env.PROMPTER_PUBLISH_KEY ?? saved.prompterPublishKey;
    if (!publishUrl || !publishKey) {
      return {
        ok: false,
        error:
          "Prompter sharing is not configured — set prompterPublishUrl and " +
          "prompterPublishKey in the studio settings (or the PROMPTER_PUBLISH_* env vars)",
      };
    }
    const tokens = saved.prompterTokens ?? {};
    const token = tokens[id] ?? randomBytes(16).toString("base64url");
    const script = prompterScript(showcasesDir, id, { publishedAt: new Date().toISOString() });
    const response = await fetch(publishUrl, {
      method: "POST",
      headers: { authorization: `Bearer ${publishKey}`, "content-type": "application/json" },
      body: JSON.stringify({ token, script }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: result.error ?? `Publish failed (${response.status})` };
    }
    settings.save({ prompterTokens: { ...tokens, [id]: token } });
    return { ok: true, url: result.url };
  }

  /** Switches the library folder (File > Open Folder in the desktop app).
   *  Remembered as the saved library and in Open Recent. A locked studio
   *  never switches. */
  function setLibrary({ dir } = {}) {
    if (lock) return { ok: false, error: "This studio is locked to one showcase" };
    const target = path.resolve(String(dir ?? ""));
    if (!dir || !isDirectory(target)) return { ok: false, error: `${target} is not a folder` };
    showcasesDir = target;
    const recents = [target, ...(settings.load().recentFolders ?? []).filter((d) => d !== target)];
    settings.save({ showcasesDir: target, recentFolders: recents.slice(0, 8) });
    scaffold();
    watchLibrary();
    register();
    emit("info", info());
    return { ok: true, library: target };
  }

  const exportJob = (kind, showcaseId) => {
    if (!EXPORT_KINDS.includes(kind)) {
      return { ok: false, error: `Unknown export kind "${kind}"` };
    }
    try {
      return { ok: true, job: exportJobs.start(kind, String(showcaseId ?? "")) };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  };

  const terminalAction = (method) => (body) =>
    terminals ? terminals[method](body) : { ok: false, error: "Terminals are off in this studio" };

  const ACTIONS = {
    "scene-edit": (body) =>
      applySceneEditToFolder(showcasesDir, body, { beforeWrite: recordSelfWrite }),
    "showcase-create": ({ name }) => createShowcase(name),
    "asset-rename": renameAsset,
    "asset-add": addAssets,
    "asset-delete": deleteAsset,
    "prompter-publish": publishPrompter,
    export: ({ kind, showcaseId }) => exportJob(String(kind ?? ""), showcaseId),
    "export-status": ({ jobId }) => {
      const job = exportJobs.status(String(jobId ?? ""));
      return job ? { ok: true, job } : { ok: false, error: `No export job named "${jobId}"` };
    },
    "export-cancel": ({ jobId }) => {
      const job = exportJobs.cancel(String(jobId ?? ""));
      return job ? { ok: true, job } : { ok: false, error: `No export job named "${jobId}"` };
    },
    library: setLibrary,
    "terminal-available": () =>
      terminals ? terminals.available() : { ptyReady: false, claude: false },
    "terminal-start": terminalAction("start"),
    "terminal-status": (body) => (terminals ? terminals.status(body) : { running: false }),
    "terminal-external": terminalAction("external"),
    "terminal-input": terminalAction("input"),
    "terminal-resize": terminalAction("resize"),
    "terminal-stop": terminalAction("stop"),
  };

  /* ---------- the request handler ---------- */

  function openEventStream(req, res) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(`event: info\ndata: ${JSON.stringify(info())}\n\n`);
    listeners.add(res);
    const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 25_000);
    req.on("close", () => {
      clearInterval(heartbeat);
      listeners.delete(res);
    });
  }

  async function handle(req, res, next) {
    const pathname = (req.url ?? "").split("?")[0] ?? "";
    try {
      if (pathname === "/showcase-data" || pathname.startsWith("/showcase-data/")) {
        const result = await handleShowcaseRequest(
          showcasesDir,
          pathname.slice("/showcase-data".length) || "/",
          { range: req.headers.range },
        );
        if (!result) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.statusCode = result.status;
        res.setHeader("Content-Type", result.type);
        for (const [name, value] of Object.entries(result.headers ?? {})) {
          res.setHeader(name, value);
        }
        res.end(result.body);
        return;
      }
      const isApi = pathname.startsWith("/studio/api/");
      if (!isApi && pathname !== "/mcp") {
        next();
        return;
      }
      if (!isLocalRequest(req)) {
        sendJson(res, 403, {
          ok: false,
          error: "The studio only answers requests from this machine",
        });
        return;
      }
      if (pathname === "/mcp") {
        await mcp(req, res);
        return;
      }
      const action = pathname.slice("/studio/api/".length);
      if (req.method === "GET" && action === "info") {
        sendJson(res, 200, info());
        return;
      }
      if (req.method === "GET" && action === "events") {
        openEventStream(req, res);
        return;
      }
      if (req.method !== "POST" || !Object.hasOwn(ACTIONS, action)) {
        sendJson(res, 404, { ok: false, error: `No studio action "${action}"` });
        return;
      }
      sendJson(res, 200, await ACTIONS[action](await readJson(req)));
    } catch (error) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: String(error?.message ?? error) });
      } else {
        res.end();
      }
    }
  }

  scaffold();
  watchLibrary();

  return {
    handle,
    info,

    /** Records where the studio is served (once its server listens):
     *  rewrites .studio/mcp.json and lists the studio as running. */
    setUrl(next) {
      url = String(next).replace(/\/$/, "");
      writeMcpConfig();
      register();
    },

    /** Runs one export now and resolves with its output (--export). */
    exportNow: (kind, showcaseId, { onProgress } = {}) =>
      runExport({
        renderer,
        appUrl: url,
        showcasesDir,
        kind,
        showcaseId,
        outDir: path.join(exportDir, showcaseId),
        onProgress,
      }),

    async close() {
      watcher?.close();
      terminals?.dispose();
      for (const res of listeners) res.end();
      listeners.clear();
      rmSync(registryFile, { force: true });
      await renderer?.dispose?.();
    },
  };
}
