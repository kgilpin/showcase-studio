/* Electron shell: the showcase app as a desktop studio.
 *
 * On launch it:
 *   1. Ensures the user's showcases folder exists (~/Showcases, or
 *      SHOWCASES_DIR), scaffolding README/.gitignore/CLAUDE.md on first
 *      run — showcases are created in-app, not seeded from samples.
 *   2. Serves that folder in the data shape the app's httpSource
 *      consumes (server/showcase-data.mjs), with CORS open so the app
 *      can fetch it from the dev-server origin. Preferred port 8123;
 *      self-host mode falls back to an OS-assigned port so several
 *      studios can run at once.
 *   3. Opens a window on the app itself: ELECTRON_APP_URL when set (npm
 *      run electron:dev points it at a vite dev server started with
 *      VITE_SHOWCASES_URL=http://127.0.0.1:8123), otherwise the built
 *      app in .output/ (npm run build:desktop) served in-process behind
 *      the data server's front door — how the packaged binary runs.
 *   4. Watches the folder and reloads the window when anything changes.
 *
 * ELECTRON_SMOKE=<path.png> captures the loaded window to a file and
 * quits — used for automated verification.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import http from "node:http";
import net from "node:net";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { handleShowcaseRequest, showcaseIndex } from "../server/showcase-data.mjs";
import { showInRecent } from "../server/library-config.mjs";
import { applySceneEditToFolder, contentHash } from "../server/scene-edit.mjs";
import { prompterScript } from "../server/prompter-script.mjs";
import { exportScreens, exportScript, exportVideo } from "./exporter.mjs";
import { registerTerminal } from "./terminal.mjs";
import { loadSettings, saveSettings } from "./settings.mjs";
import { createExportJobs } from "../server/export-jobs.mjs";
import { createMcpHandler } from "./mcp.mjs";
import { whisperPath } from "./transcribe.mjs";
import { hasStaleInlineGuide, studioGuide } from "../server/showcase-guide.mjs";

/* In dev the macOS menu-bar TITLE still reads "Electron" (it comes from
 * the binary's Info.plist and can't change at runtime — a packaged build
 * fixes it), but the items inside (About/Hide/Quit …) follow app.name. */
app.setName("Showcase Studio");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
/* In dev app.getVersion() reports Electron's own version — the app's
 * version lives in package.json. */
const appVersion = require_("../package.json").version;
let ffmpegPath;
try {
  ffmpegPath = require_("ffmpeg-static");
} catch {
  /* exports degrade too; the guide says "(unavailable)" */
}

/* Without ELECTRON_APP_URL (a dev server), serve the built app from
 * .output/ (npm run build:desktop) in this process — the packaged
 * binary's mode. One front-door server per instance serves the data
 * shape and MCP and proxies everything else to the built app server,
 * and the client is built with a relative data URL (/showcase-data), so
 * several studios can run at once: the front door prefers SHOWCASES_PORT
 * (8123, keeping existing .studio/mcp.json links stable) and falls back
 * to an OS-assigned port when another studio holds it, and the built app
 * server always takes an OS-assigned port (STUDIO_APP_PORT overrides).
 * In dev mode the ports stay fixed and taken-port failures stay loud:
 * the dev client bakes an absolute data URL, so a silent fallback would
 * cross-wire two studios' libraries. */
const requestedDataPort = Number(process.env.SHOWCASES_PORT ?? 8123);
let dataPort = requestedDataPort;

const builtServer = path.join(repoRoot, ".output", "server", "index.mjs");
const selfHost = !process.env.ELECTRON_APP_URL && existsSync(builtServer);
let appPort = Number(process.env.STUDIO_APP_PORT ?? 0);
/* Self-host: set once the front door is listening. */
let appUrl = process.env.ELECTRON_APP_URL ?? null;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

async function serveBuiltApp() {
  if (!appPort) appPort = await freePort();
  process.env.PORT = String(appPort);
  process.env.HOST = "127.0.0.1";
  await import(pathToFileURL(builtServer).href);
}

/** Streams a front-door request through to the built app server. */
function proxyToBuiltApp(req, res) {
  const upstream = http.request(
    { host: "127.0.0.1", port: appPort, path: req.url, method: req.method, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", () => {
    if (!res.headersSent) res.statusCode = 502;
    res.end("app server unavailable");
  });
  req.pipe(upstream);
}

/* The showcases folder is the user's content repo — a plain directory
 * they can `git init` and version themselves (the app never runs git;
 * checkouts and branch switches simply live-reload). Resolution:
 * SHOWCASES_DIR env → the persisted choice (Menu → Choose Showcases
 * Folder…) → ~/Showcases. */
let showcasesDir =
  process.env.SHOWCASES_DIR ??
  loadSettings().showcasesDir ??
  path.join(app.getPath("home"), "Showcases");

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
 * user; .studio/GUIDE.md belongs to the studio and is rewritten on
 * every launch (and folder switch), so any Claude Code session here —
 * embedded, external, or user-started — always sees instructions that
 * match the running app. The seeded CLAUDE.md pulls the guide in via
 * Claude Code's @-import; folders seeded before the split get the
 * import line (and the .gitignore entry) appended once. */
const GUIDE_IMPORT = "@.studio/GUIDE.md";

function ensureShowcasesDir() {
  mkdirSync(path.join(showcasesDir, ".studio"), { recursive: true });
  const claudeMdPath = path.join(showcasesDir, "CLAUDE.md");
  const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf8") : null;
  writeFileSync(
    path.join(showcasesDir, ".studio", "GUIDE.md"),
    studioGuide({
      version: appVersion,
      srcDir: repoRoot,
      ffmpegPath,
      showcasesDir,
      staleClaudeMd: claudeMd != null && hasStaleInlineGuide(claudeMd),
    }),
  );
  /* The studio's MCP tools; studio-opened terminals load this via
   * --mcp-config, and a user-started `claude` can point at it too. */
  writeFileSync(
    path.join(showcasesDir, ".studio", "mcp.json"),
    JSON.stringify(
      {
        mcpServers: {
          "showcase-studio": { type: "http", url: `http://127.0.0.1:${dataPort}/mcp` },
        },
      },
      null,
      2,
    ) + "\n",
  );
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

/* Export jobs run in this process against the main window (progress also
 * streams to the export page); MCP is the control surface. */
let mainWindow;
const exportJobs = createExportJobs((kind, showcaseId, { onProgress, signal }) =>
  runExport(kind, showcaseId, mainWindow, { onProgress, signal }),
);

function serveData() {
  let mcp;
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url === "/mcp") {
      if (!mcp) {
        res.statusCode = 503;
        res.end("starting");
        return;
      }
      void mcp(req, res);
      return;
    }
    /* The data shape lives under /showcase-data (what the self-host
     * client is built against) and, for the dev client's absolute URLs,
     * at the root. In self-host mode every other path is the app's. */
    const dataPath = url.startsWith("/showcase-data")
      ? url.slice("/showcase-data".length) || "/"
      : selfHost
        ? null
        : url;
    if (dataPath == null) {
      proxyToBuiltApp(req, res);
      return;
    }
    handleShowcaseRequest(showcasesDir, dataPath, { range: req.headers.range }).then(
      (result) => {
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
      },
      (error) => {
        res.statusCode = 500;
        res.end(String(error));
      },
    );
  });
  let retried = false;
  return new Promise((resolve) => {
    server.on("error", (error) => {
      /* Self-host: the preferred port being taken just means another
       * studio is running — fall back to an OS-assigned port; the
       * client's relative URLs follow the page. Everything else (and
       * any dev-mode error) fails loudly — a silent EADDRINUSE would
       * leave the dev app serving another instance's data. */
      if (selfHost && error.code === "EADDRINUSE" && !retried) {
        retried = true;
        server.listen(0, "127.0.0.1");
        return;
      }
      console.error(`Showcase data server failed on port ${dataPort}: ${error.message}`);
      app.exit(1);
    });
    server.on("listening", () => {
      dataPort = server.address().port;
      appUrl ??= `http://127.0.0.1:${dataPort}`;
      mcp = createMcpHandler({
        appUrl,
        version: appVersion,
        getShowcasesDir: () => showcasesDir,
        exportJobs,
      });
      resolve(server);
    });
    server.listen(dataPort, "127.0.0.1");
  });
}

/* Self-write suppression. Edits made through the app's own scene-edit
 * IPC are already applied to the renderer's in-page model, so the
 * watcher must not answer them with a full page reload (the "flash").
 * Each such write records the content hash it produced; when every file
 * in a watch burst still matches its recorded hash, the burst is the
 * echo of our own writes and is swallowed. Anything else — agent edits,
 * hand edits, git checkouts — reloads the window as before. */
const selfWrites = new Map();
function recordSelfWrite(file, content) {
  selfWrites.set(file, { hash: contentHash(content), at: Date.now() });
}
function isSelfWriteEcho(file) {
  const entry = selfWrites.get(file);
  if (!entry || Date.now() - entry.at > 10_000) return false;
  try {
    return contentHash(readFileSync(file)) === entry.hash;
  } catch {
    return false;
  }
}

let watcher;
function watchShowcases(win) {
  watcher?.close();
  let timer;
  const pending = new Set();
  watcher = watch(showcasesDir, { recursive: true }, (_event, filename) => {
    pending.add(filename == null ? null : path.join(showcasesDir, filename));
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = [...pending];
      pending.clear();
      if (changed.every((file) => file != null && isSelfWriteEcho(file))) return;
      win.webContents.reloadIgnoringCache();
    }, 250);
  });
}

/** Points the studio at a showcases directory — typically a git repo the
 *  user manages. Persisted across launches, and remembered in Open Recent. */
function setShowcasesFolder(dir, win) {
  showcasesDir = dir;
  const recents = [dir, ...(loadSettings().recentFolders ?? []).filter((d) => d !== dir)];
  saveSettings({ showcasesDir: dir, recentFolders: recents.slice(0, 8) });
  ensureShowcasesDir();
  watchShowcases(win);
  /* A new library means the current route may not exist anymore — land
   * on Home rather than a "no such showcase" page. */
  void win.loadURL(appUrl);
  buildMenu(win);
}

/** File → Open Folder…: the directory picker in front of setShowcasesFolder. */
async function chooseShowcasesFolder(win) {
  const picked = await dialog.showOpenDialog(win, {
    title: "Open Showcases Folder",
    buttonLabel: "Open Folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: showcasesDir,
  });
  const dir = picked.filePaths[0];
  if (picked.canceled || !dir) return;
  setShowcasesFolder(dir, win);
}

/* Exports are driven by Claude through the MCP export tools (and the
 * showcase's export page) — no File menu items while that flow settles. */
function buildMenu(win) {
  const home = app.getPath("home");
  /* A folder can opt out of Open Recent with show_in_recent: false in a
   * root-level showcase.yaml (server/library-config.mjs). It stays in
   * the persisted list — flipping the setting back brings it back. */
  const recents = (loadSettings().recentFolders ?? []).filter(
    (dir) => dir !== showcasesDir && showInRecent(dir),
  );
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: () => void chooseShowcasesFolder(win),
        },
        {
          label: "Open Recent",
          submenu: [
            ...recents.map((dir) => ({
              label: dir.startsWith(home) ? `~${dir.slice(home.length)}` : dir,
              click: () => setShowcasesFolder(dir, win),
            })),
            ...(recents.length ? [{ type: "separator" }] : []),
            {
              label: "Clear Menu",
              enabled: recents.length > 0,
              click: () => {
                saveSettings({ recentFolders: [] });
                buildMenu(win);
              },
            },
          ],
        },
        {
          label: process.platform === "darwin" ? "Reveal in Finder" : "Show in File Manager",
          click: () => void shell.openPath(showcasesDir),
        },
        ...(process.platform === "darwin" ? [] : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Runs one export, streaming progress to the studio window when open.
 *  Kinds: screens, script, video, video-draft, and the 4:3 embed canvas
 *  video-43 / video-43-draft. Drafts run 12fps at half size. */
async function runExport(kind, showcaseId, win, { onProgress, signal } = {}) {
  const progress = (label) => {
    // The window can be gone (quit mid-export) — sending then throws.
    if (win && !win.isDestroyed()) {
      win.webContents.send("export-progress", { showcaseId, kind, label });
    }
    onProgress?.(label);
    if (process.env.ELECTRON_EXPORT) console.log(`${kind} ${showcaseId}: ${label}`);
  };
  const outDir = path.join(app.getPath("downloads"), "showcase-exports", showcaseId);
  const options = { showcasesDir, showcaseId, appUrl, outDir, progress, signal };
  const draft = kind.endsWith("-draft");
  const canvas = kind.startsWith("video-43") ? "embed" : "portrait";
  const fps = Number(process.env.EXPORT_FPS ?? (draft ? 12 : 30));
  const out =
    kind === "screens"
      ? await exportScreens(options)
      : kind === "script"
        ? await exportScript(options)
        : await exportVideo({ ...options, draft, canvas, fps });
  if (win && !win.isDestroyed()) {
    win.webContents.send("export-progress", { showcaseId, kind, label: "done", done: true, out });
  }
  return out;
}

app.whenReady().then(async () => {
  if (selfHost) {
    try {
      await serveBuiltApp();
    } catch (error) {
      dialog.showErrorBox("Showcase Studio", `The app server failed to start: ${error.message}`);
      app.exit(1);
      return;
    }
  }
  /* The front door picks its real port here; ensureShowcasesDir writes
   * .studio/mcp.json from it, so it must come after. */
  await serveData();
  ensureShowcasesDir();

  /* Headless export (also the automated-test hook):
   * ELECTRON_EXPORT=screens:<id> or video:<id> runs it and quits. */
  if (process.env.ELECTRON_EXPORT) {
    const [kind, showcaseId] = process.env.ELECTRON_EXPORT.split(":");
    try {
      console.log(`exported: ${await runExport(kind, showcaseId, undefined)}`);
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
    return;
  }

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Showcase Studio",
    show: !process.env.ELECTRON_SMOKE,
    webPreferences: {
      preload: path.join(path.dirname(fileURLToPath(import.meta.url)), "preload.cjs"),
    },
  });
  mainWindow = win;

  /* A file dropped outside a drop target must not navigate the app to
   * file:// (Chromium's default) — that would blank the studio. */
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) event.preventDefault();
  });

  ipcMain.handle("export-screens", async (_event, showcaseId) => {
    const out = await runExport("screens", showcaseId, win);
    shell.showItemInFolder(out);
    return out;
  });
  ipcMain.handle("export-video", async (_event, showcaseId) => {
    const out = await runExport("video", showcaseId, win);
    shell.showItemInFolder(out);
    return out;
  });

  /* Scaffolds a new showcase folder (the home page's "+" card). */
  ipcMain.handle("showcase-create", (_event, name) => {
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
  soundtrack: { src: "", volume: 0.2 }

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
    return { ok: true, id };
  });

  /* Facts every Claude session should have on hand, computed at spawn so
   * they track the running app (and folder switches). The generated
   * .studio/GUIDE.md explains each one. */
  const studioEnv = () => ({
    SHOWCASE_STUDIO_ROOT: showcasesDir,
    SHOWCASE_STUDIO_SRC: repoRoot,
    ...(ffmpegPath ? { SHOWCASE_STUDIO_FFMPEG: ffmpegPath } : {}),
    ...(whisperPath() ? { SHOWCASE_STUDIO_WHISPER: whisperPath() } : {}),
  });
  /* One whitelisted field edit on a scene in showcase.yaml — the write
   * path behind in-app editing (titles, captions, scene media), all in
   * scene-edit.mjs. The write is recorded before it lands so the watcher
   * recognizes its echo — the renderer has already applied the change to
   * its own model. */
  ipcMain.handle("scene-edit", (_event, payload) =>
    applySceneEditToFolder(showcasesDir, payload, { beforeWrite: recordSelfWrite }),
  );

  /* Shares a showcase's script as a phone teleprompter: derives the
   * snapshot (server/prompter-script.mjs) and POSTs it to the prompter
   * site's publish endpoint (cdk/). The token — the capability in the
   * URL — is generated once per showcase and remembered, so publishing
   * again updates the same link the narrator already has. Configure with
   * PROMPTER_PUBLISH_URL / PROMPTER_PUBLISH_KEY, or prompterPublishUrl /
   * prompterPublishKey in settings.json. */
  ipcMain.handle("prompter-publish", async (_event, showcaseId) => {
    try {
      const id = String(showcaseId ?? "");
      if (!id || /[/\\]|\.\./.test(id)) return { ok: false, error: "Bad showcase id" };
      const settings = loadSettings();
      const publishUrl = process.env.PROMPTER_PUBLISH_URL ?? settings.prompterPublishUrl;
      const publishKey = process.env.PROMPTER_PUBLISH_KEY ?? settings.prompterPublishKey;
      if (!publishUrl || !publishKey) {
        return {
          ok: false,
          error:
            "Prompter sharing is not configured — set prompterPublishUrl and " +
            "prompterPublishKey in the studio settings (or the PROMPTER_PUBLISH_* env vars)",
        };
      }
      const tokens = settings.prompterTokens ?? {};
      const token = tokens[id] ?? randomBytes(16).toString("base64url");
      const script = prompterScript(showcasesDir, id, {
        publishedAt: new Date().toISOString(),
      });
      const response = await fetch(publishUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${publishKey}`, "content-type": "application/json" },
        body: JSON.stringify({ token, script }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { ok: false, error: result.error ?? `Publish failed (${response.status})` };
      }
      saveSettings({ prompterTokens: { ...tokens, [id]: token } });
      return { ok: true, url: result.url };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  /* Renames an asset file and updates every YAML reference to it — the
   * bare key and the full file name, in asset:/src:/cover: fields only,
   * so narration text mentioning the same word is left alone. */
  ipcMain.handle("asset-rename", (_event, { showcaseId, from, to } = {}) => {
    try {
      const id = String(showcaseId ?? "");
      const oldName = String(from ?? "");
      const bad = (s) => !s || s.includes("/") || s.includes("\\") || s.includes("..");
      if (bad(id) || bad(oldName)) return { ok: false, error: "Bad name" };
      let newName = String(to ?? "").trim();
      if (!newName) return { ok: false, error: "Give the asset a name" };
      if (!path.extname(newName)) newName += path.extname(oldName);
      if (bad(newName)) return { ok: false, error: "Bad name" };
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
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  /* Adds files to the showcase's assets/ folder — the drop target on
   * the assets page. All files arrive in one call (base64) and are all
   * written before the watcher's reload can interrupt; names are
   * de-duplicated (name-2.png), never overwritten. */
  ipcMain.handle("asset-add", (_event, { showcaseId, files } = {}) => {
    try {
      const id = String(showcaseId ?? "");
      const bad = (s) => !s || s.includes("/") || s.includes("\\") || s.includes("..");
      if (bad(id)) return { ok: false, error: "Bad showcase id" };
      if (!Array.isArray(files) || files.length === 0) return { ok: false, error: "No files" };
      const dir = path.join(showcasesDir, id, "assets");
      if (!existsSync(path.join(showcasesDir, id))) {
        return { ok: false, error: `No showcase named "${id}"` };
      }
      mkdirSync(dir, { recursive: true });
      const written = [];
      for (const file of files) {
        const name = String(file?.name ?? "").trim();
        if (bad(name)) return { ok: false, error: `Bad file name "${name}"` };
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
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  /* Deletes one asset file (the page confirms first). YAML references
   * are left alone — a dangling key shows up in the assets page's
   * "referenced but missing" list, which is the honest state. */
  ipcMain.handle("asset-delete", (_event, { showcaseId, name } = {}) => {
    try {
      const id = String(showcaseId ?? "");
      const fileName = String(name ?? "");
      const bad = (s) => !s || s.includes("/") || s.includes("\\") || s.includes("..");
      if (bad(id) || bad(fileName)) return { ok: false, error: "Bad name" };
      const file = path.join(showcasesDir, id, "assets", fileName);
      if (!existsSync(file)) {
        return { ok: false, error: `No file named "${fileName}" in ${id}/assets` };
      }
      unlinkSync(file);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  });

  const terminal = registerTerminal(ipcMain, win, {
    getCwd: () => showcasesDir,
    getEnv: studioEnv,
    getMcpConfig: () => path.join(showcasesDir, ".studio", "mcp.json"),
  });
  app.on("before-quit", () => terminal.dispose());

  buildMenu(win);
  try {
    await win.loadURL(appUrl + (process.env.ELECTRON_SMOKE_PATH ?? ""));
  } catch (error) {
    console.error(`Failed to load ${appUrl}:`, error.message ?? error);
    if (process.env.ELECTRON_SMOKE) app.exit(1);
  }
  watchShowcases(win);

  if (process.env.ELECTRON_SMOKE) {
    setTimeout(async () => {
      try {
        /* Routes are client-only (ssr: false) — on a cold dev server
         * hydration can outlast any fixed delay, so wait for real
         * content (up to 15s) before doing anything else. */
        await win.webContents.executeJavaScript(`(async () => {
          for (let i = 0; i < 150 && !document.body.innerText.trim(); i++) {
            await new Promise((r) => setTimeout(r, 100));
          }
        })()`);
        /* ELECTRON_SMOKE_EDIT=1 exercises in-app editing end to end:
         * a scenes.edit through the bridge must land in showcase.yaml,
         * and the watcher must swallow its echo (no page reload). */
        if (process.env.ELECTRON_SMOKE_EDIT) {
          const exec = (code) => win.webContents.executeJavaScript(code);
          const first = showcaseIndex(showcasesDir).showcases[0];
          const yamlPath = path.join(showcasesDir, first.id, "showcase.yaml");
          const sceneId = /\n\s*-\s+id:\s*([\w-]+)/.exec(readFileSync(yamlPath, "utf8"))?.[1];
          await exec("window.__stayed = true");
          const edited = await exec(
            `window.showcaseStudio.scenes.edit(${JSON.stringify({
              showcaseId: first.id,
              sceneId,
              field: "title",
              value: "Edited by smoke",
            })})`,
          );
          await new Promise((r) => setTimeout(r, 1500)); // outlive the watcher debounce
          console.log("smoke edit:", JSON.stringify(edited));
          console.log(
            "smoke edit written:",
            readFileSync(yamlPath, "utf8").includes("Edited by smoke"),
          );
          console.log("smoke edit no reload:", await exec("window.__stayed === true"));
        }
        /* ELECTRON_SMOKE_SHARE=1 publishes the first showcase's prompter
         * snapshot through the real bridge and logs the share URL —
         * needs the publish endpoint configured (settings or env). */
        if (process.env.ELECTRON_SMOKE_SHARE) {
          const first = showcaseIndex(showcasesDir).showcases[0];
          const shared = await win.webContents.executeJavaScript(
            `window.showcaseStudio.prompter.publish(${JSON.stringify(first.id)})`,
          );
          console.log("smoke share:", JSON.stringify(shared));
        }
        /* ELECTRON_SMOKE_AGENT=1 additionally exercises the agent bridge:
         * reports key status, verifies a bogus key is rejected, and opens
         * the panel so the capture shows it. */
        if (process.env.ELECTRON_SMOKE_AGENT) {
          const exec = (code) => win.webContents.executeJavaScript(code);
          console.log(
            "smoke terminal available:",
            JSON.stringify(await exec("window.showcaseStudio.terminal.available()")),
          );
          if (process.env.ELECTRON_SMOKE_MENU) {
            // Menu mode: capture the page as-is, then exercise creation below.
          } else {
            await exec(`document.querySelector('[aria-label="Open the studio agent"]')?.click()`);
            // Pick the integrated terminal from the chooser, then give
            // Claude Code time to boot before capturing.
            await new Promise((r) => setTimeout(r, 800));
            await exec(
              `[...document.querySelectorAll("button")].find((b) => b.textContent.includes("Integrated terminal"))?.click()`,
            );
            await new Promise((r) => setTimeout(r, 4000));
          }
        }
        const image = await win.webContents.capturePage();
        writeFileSync(process.env.ELECTRON_SMOKE, image.toPNG());
        console.log(`smoke: captured ${process.env.ELECTRON_SMOKE} from ${appUrl}`);
        if (process.env.ELECTRON_SMOKE_MENU) {
          /* Exercise showcase creation last — the write triggers the
           * folder watcher's reload, which can strand in-flight
           * executeJavaScript calls, hence the race. */
          const created = await Promise.race([
            win.webContents.executeJavaScript(
              `window.showcaseStudio.showcases.create("Flow Test")`,
            ),
            new Promise((resolve) => setTimeout(() => resolve({ raced: true }), 3000)),
          ]);
          console.log("smoke create:", JSON.stringify(created));
        }
      } catch (error) {
        console.error("smoke failed:", error);
      }
      app.quit();
    }, 4000);
  }
});

app.on("window-all-closed", () => app.quit());
