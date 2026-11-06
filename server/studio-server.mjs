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
 *   GET  /studio/api/history    the library's git history status, for the
 *                               "Commit changes to git" switch
 *   GET  /studio/api/events     live events (server-sent events): reload,
 *                               info, export, build, terminal-data, terminal-exit
 *   GET  /studio/api/export-video?showcase=<id>&id=<record id>
 *                               a recorded export's video, for the Share
 *                               page's preview (byte ranges, so it seeks)
 *   GET  /studio/api/frame?showcase=<id>&at=<ms>[&view=tiktok|43][&safeArea=1]
 *                               one frame of the video at that time, as a
 *                               PNG to save (the player's Frame button;
 *                               the screenshot_frame MCP tool renders the
 *                               same page)
 *   POST /studio/api/<action>   page actions, JSON in and out (ACTIONS below)
 *   POST /mcp                   the MCP tools, for Claude (server/mcp.mjs)
 *
 * Everything the studio serves — library files, API, events, MCP — only
 * answers requests made on this machine: the files are private, and the
 * actions write files and start terminals.
 *
 * The studio also keeps its library folder scaffolded (README, CLAUDE.md,
 * .studio/GUIDE.md, .studio/mcp.json), and watches it and tells pages to
 * reload when files change outside the studio. callTool runs the MCP tools
 * in-process, for the studio Claude Code starts over stdio
 * (scripts/studio-mcp.mjs). */
import {
  appendFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { isPair, isScalar, isSeq, parseDocument, visit } from "yaml";
import { buildMedia } from "./build-media.mjs";
import { buildVoiceover, hasVoiceover } from "./voiceover.mjs";
import { addAssetData } from "./asset-files.mjs";
import { createChangeLog, editForLog } from "./change-log.mjs";
import { watchStudioCode } from "./code-changes.mjs";
import { createExportJobs } from "./export-jobs.mjs";
import { DEFAULT_EXPORT_DIR, revealInFileManager } from "./export-output.mjs";
import { createExportRecords, RECORDED_KINDS, showcaseDurationMs } from "./export-records.mjs";
import { frameFileName, runExport, screenshotFrame, videoFps } from "./exporter.mjs";
import { registerStudio } from "../src/lib/page-error.mjs";
import { SHOWCASE_SCHEMA } from "../src/content/showcase-schema.mjs";
import { EXPORT_KINDS } from "./launch-options.mjs";
import { callTool, createMcpHandler } from "./mcp.mjs";
import { prompterScript } from "./prompter-script.mjs";
import { applySceneEditToFolder, contentHash } from "./scene-edit.mjs";
import { handleShowcaseRequest, showcaseIndex } from "./showcase-data.mjs";
import { createShowcaseHistory } from "./showcase-history.mjs";
import { alreadyOpen, clearPresence, runningStudio, writePresence } from "./studio-presence.mjs";
import { hasStaleInlineGuide, studioGuide } from "./showcase-guide.mjs";
import { ensureLibrarySettings, libraryExportDir } from "./library-config.mjs";
import { loadSettings, saveSettings } from "./settings.mjs";
import { airDrop, canAirDrop } from "./airdrop.mjs";
import { copyToClipboard, createShare, openInBrowser } from "./share.mjs";
import { createLicense, LicenseRequired } from "./license.mjs";
import { createTerminals } from "./terminals.mjs";
import { whisperPath } from "./transcribe.mjs";

const require_ = createRequire(import.meta.url);
let ffmpegPath;
try {
  ffmpegPath = require_("ffmpeg-static");
} catch {
  /* exports degrade too; the guide says "(unavailable)" */
}

/* The README's settings paragraph before the file was renamed. A README
 * that still has it word for word gets the new one; any other README is
 * the user's, and stays as it is. */
const OLD_README_SETTINGS = `A showcase.yaml at this top level (next to the showcase folders) holds
library settings — currently just one:`;
const README_SETTINGS = `showcase_settings.yaml at this top level (next to the showcase folders)
marks this folder as a library and holds its settings — currently just one:`;

const FOLDER_README = `# Showcases

This folder is managed by Showcase Studio. Each showcase is a folder:

    <id>/showcase.yaml   the script: scenes, narration, timing
    <id>/theme.yaml      optional styling (colors, fonts, atmosphere)
    <id>/assets/         screenshots and marks (asset keys = file names without extension)
    <id>/graphics/       optional TSX diagrams (default-export React components, CSS-only animation)

${README_SETTINGS}

    show_in_recent: false   keep this folder out of File > Open Recent

The studio live-reloads whenever files here change.

When this folder is inside a git repository, the studio keeps a history:
a few seconds after a showcase stops changing, it commits that showcase's
folder (and nothing else) with a message saying what changed. Find those
commits with \`git log --grep Showcase-Studio\`. Revert one with
\`git revert <sha>\`, or start a new cut with \`git switch -c <name>\` —
switching branches reloads the app. If this folder isn't in a git
repository yet, the studio starts one the first time it has a change to
save, so there is a history from your first edit. To turn commits off
(or back on) — which also stops it starting one — use the "Commit
changes to git" switch under the gear button at the top right of a
showcase's screens.
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

/* Earlier studios wrote a .claude/launch.json into each showcase folder
 * for Claude Code's preview button. That button started a second studio,
 * separate from the one the MCP tools use, so Claude now opens the
 * preview itself, at studio_start's URL. On start the studio removes the
 * files it wrote, which begin with this marker line; a launch.json
 * without it is the user's own and is left alone. */
const LAUNCH_MARKER = "// Written by Showcase Studio";

/* The production prompter site's publish endpoint (the PublishUrl output
 * of cdk/'s ShowcasePrompterStack-Prod). It changes only if that stack's
 * publish function is replaced. */
const PROMPTER_PUBLISH_URL =
  "https://zg6kaabzhvp2m55d2zrug7n3d40agpus.lambda-url.us-east-1.on.aws/";

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

/** Where each rewritten asset reference sits in showcase.yaml `text`:
 *  its key path ("scenes.2.media.asset") and, inside a scene, the scene's
 *  id. `found` holds each value's offset in `text` (`at`) and the names
 *  it changed between. */
function locateReferences(text, found) {
  const doc = parseDocument(text);
  const located = new Map();
  visit(doc, {
    Scalar(_key, node, ancestors) {
      const [start, end] = node.range ?? [];
      const hit = found.find((f) => start <= f.at && f.at < end);
      if (!hit || located.has(hit)) return;
      const chain = [...ancestors, node];
      const keys = [];
      chain.forEach((item, i) => {
        if (isPair(item)) keys.push(isScalar(item.key) ? item.key.value : String(item.key));
        else if (isSeq(item)) keys.push(item.items.indexOf(chain[i + 1]));
      });
      const sceneId =
        keys[0] === "scenes" && Number.isInteger(keys[1])
          ? doc.getIn(["scenes", keys[1], "id"])
          : undefined;
      located.set(hit, {
        path: keys.join("."),
        ...(sceneId != null ? { sceneId: String(sceneId) } : {}),
        from: hit.from,
        to: hit.to,
      });
    },
  });
  return found.map((f) => located.get(f) ?? { from: f.from, to: f.to });
}

/**
 * Creates a studio for one library folder.
 *
 *   showcasesDir  the library
 *   lock          { kind: "showcase", showcaseId } | { kind: "new" } | null
 *   version       the app version (reported in info and MCP)
 *   srcDir        the studio app's source, for the guide and terminals
 *   renderer      draws pages for screenshots and exports (optional)
 *   features      { terminal: false } turns the embedded terminals off;
 *                 { autoCommit: false } makes git commits off until the
 *                 user turns them on (the studio Claude Code starts —
 *                 the session commits its own work); { watch: false }
 *                 leaves the library unwatched, so pages don't reload on
 *                 outside changes (tests: the watcher's timer would
 *                 otherwise race each test's end, and gold traces would
 *                 record it only sometimes) — and the studio's own code
 *                 unwatched too (server/code-changes.mjs)
 *   exportDir    where exports land (<exportDir>/<showcase id>), unless
 *                 the library's showcase_settings.yaml names its own
 *                 export_dir (server/library-config.mjs)
 *   reveal        opens the file manager on a path (export-reveal)
 *   openUrl       opens a web page in the user's browser (a share
 *                 hand-off's upload page)
 *   copyText      puts text on the system clipboard (the share tool)
 *   sendToPhone   opens the AirDrop window for a file (a Mac only)
 *   settings      { load, save } — the persisted settings
 *   licensing     makes the license client (server/license.mjs) from
 *                 { settings, openUrl, onChange }; tests pass a fake, so
 *                 nothing reaches the license service
 *   commitDelayMs how long a showcase must stay unchanged before the
 *                 studio commits it (server/showcase-history.mjs)
 */
export function createStudio({
  showcasesDir: initialDir,
  lock: initialLock = null,
  version,
  srcDir,
  renderer,
  features = {},
  exportDir = DEFAULT_EXPORT_DIR,
  reveal = revealInFileManager,
  openUrl = openInBrowser,
  copyText = copyToClipboard,
  sendToPhone = canAirDrop() ? airDrop : null,
  settings = { load: loadSettings, save: saveSettings },
  licensing = createLicense,
  log = (message) => console.log(message),
  commitDelayMs = 5000,
}) {
  let showcasesDir = path.resolve(initialDir);
  /* While this studio runs, the page's error page may show error details
   * to requests from this machine (src/lib/page-error.mjs). */
  const unregisterStudio = registerStudio();
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

  let codeWatch = null;
  const info = () => ({
    version,
    url,
    library: showcasesDir,
    lock,
    features: { terminal: terminalsOn, airDrop: sendToPhone != null },
    pid: process.pid,
    startedAt,
    /* The studio's code files changed since it started, from source
     * (server/code-changes.mjs): the page shows a banner until a restart. */
    ...(codeWatch ? { changedCode: codeWatch.changed() } : {}),
  });

  /* The app's source, when it is really there. The studio run from source
   * has it; the packaged app ships only the modules it runs, so the guide
   * and terminals mustn't send sessions looking for it. */
  const sourceDir =
    srcDir && existsSync(path.join(srcDir, "src", "components")) ? srcDir : undefined;

  /* From source, Node keeps running the server code it loaded at the
   * start while Vite serves the page every save (issue #18). Watch that
   * code and tell the pages when it differs from what runs. */
  if (sourceDir && features.watch !== false) {
    codeWatch = watchStudioCode(sourceDir, {
      onChange: (changed) => emit("code", { changed }),
      onError: (message) => log(`studio: not watching its own code (${message})`),
    });
  }

  /* ---------- the library folder ---------- */

  function scaffold() {
    mkdirSync(path.join(showcasesDir, ".studio"), { recursive: true });
    const claudeMdPath = path.join(showcasesDir, "CLAUDE.md");
    const claudeMd = existsSync(claudeMdPath) ? readFileSync(claudeMdPath, "utf8") : null;
    writeFileSync(
      path.join(showcasesDir, ".studio", "GUIDE.md"),
      studioGuide({
        version,
        srcDir: sourceDir,
        ffmpegPath,
        whisperPath: whisperPath(),
        showcasesDir,
        staleClaudeMd: claudeMd != null && hasStaleInlineGuide(claudeMd),
      }),
    );
    /* The field reference beside the guide: what a session reads for
     * the fields, their types and where each one goes. */
    writeFileSync(
      path.join(showcasesDir, ".studio", "showcase.schema.json"),
      JSON.stringify(SHOWCASE_SCHEMA, null, 2) + "\n",
    );
    writeMcpConfig();
    /* The settings file marks the folder as a library. An older
     * library's had the same name as a showcase's script; rename it. */
    try {
      ensureLibrarySettings(showcasesDir);
    } catch (error) {
      console.warn(`[studio] couldn't set up showcase_settings.yaml: ${error.message}`);
    }
    const readmePath = path.join(showcasesDir, "README.md");
    if (!existsSync(readmePath)) {
      writeFileSync(readmePath, FOLDER_README);
    } else {
      const readme = readFileSync(readmePath, "utf8");
      if (readme.includes(OLD_README_SETTINGS)) {
        writeFileSync(readmePath, readme.replace(OLD_README_SETTINGS, README_SETTINGS));
      }
    }
    const gitignorePath = path.join(showcasesDir, ".gitignore");
    if (!existsSync(gitignorePath)) {
      writeFileSync(gitignorePath, `.DS_Store\n.studio/\n`);
    } else if (!readFileSync(gitignorePath, "utf8").includes(".studio/")) {
      appendFileSync(gitignorePath, `.studio/\n`);
    }
    removeLaunchConfigs();
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

  /* Removes the launch.json files an earlier studio wrote (see
   * LAUNCH_MARKER), and their .claude folder when nothing else is in it. */
  function removeLaunchConfigs() {
    let ids;
    try {
      ids = showcaseIndex(showcasesDir).showcases.map((showcase) => showcase.id);
    } catch {
      return;
    }
    for (const id of ids) {
      const dir = path.join(showcasesDir, id, ".claude");
      const file = path.join(dir, "launch.json");
      try {
        if (!readFileSync(file, "utf8").startsWith(LAUNCH_MARKER)) continue;
        unlinkSync(file);
        if (readdirSync(dir).length === 0) rmdirSync(dir);
      } catch {
        /* No file, or one we can't read or remove: leave it. */
      }
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
  let reloadTimer;
  function watchLibrary() {
    watcher?.close();
    clearTimeout(reloadTimer);
    if (features.watch === false) return;
    const pending = new Set();
    try {
      watcher = watch(showcasesDir, { recursive: true }, (_event, filename) => {
        /* The studio's own bookkeeping, git, and Claude Code's settings
         * (.claude/ at any level) never change what pages show. */
        if (filename != null && /^(\.studio|\.git)([/\\]|$)/.test(filename)) return;
        if (filename != null && /(^|[/\\])\.claude([/\\]|$)/.test(filename)) return;
        /* No commit starts here. The history commits what the studio
         * wrote, and those writes reach it through the change log
         * (onAppend below). A change made anywhere else — an editor, a
         * git checkout, another program, a Claude session's own file
         * tools — is its author's to commit; it only rides along in the
         * studio's next commit of that showcase. */
        pending.add(filename == null ? null : path.join(showcasesDir, filename));
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
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

  /* ---------- exports ---------- */

  /* The videos, full quality and draft, are recorded
   * (server/export-records.mjs), so the Share page knows whether the file
   * on disk still matches the showcase, and about how long a new one
   * takes. The fingerprint is taken as the export starts: an edit made
   * while it renders leaves the new file stale, as it should. */
  const exportRecords = createExportRecords({
    getLibrary: () => showcasesDir,
    appVersion: version,
  });
  const share = createShare({ getLibrary: () => showcasesDir, exportRecords });

  /* ---------- licensing (server/license.mjs) ---------- */

  /* Every change to what the page should show — a check, a checkout
   * paid, a free video used — goes to every page as the "license" event. */
  const license = licensing({
    settings,
    openUrl,
    onChange: (status) => emit("license", status),
  });

  /** Where a showcase's exports go: the library's own export_dir when its
   *  settings name one, else the studio's export folder. */
  function exportFolder(showcaseId) {
    return path.join(libraryExportDir(showcasesDir) ?? exportDir, showcaseId);
  }

  async function recordedExport(kind, showcaseId, { onProgress, signal } = {}) {
    /* Full-quality videos need a license or a free export; the page asks
     * first, so this refusal is what Claude's export tool (and --export)
     * meet. */
    const verdict = await license.beforeExport(kind);
    if (!verdict.allowed) throw new LicenseRequired(verdict.message);
    const recorded = RECORDED_KINDS.includes(kind);
    const fingerprint = recorded ? exportRecords.fingerprint(showcaseId) : undefined;
    const durationMs = recorded ? showcaseDurationMs(showcasesDir, showcaseId) : undefined;
    const started = Date.now();
    const out = await runExport({
      renderer,
      appUrl: url,
      showcasesDir,
      kind,
      showcaseId,
      outDir: exportFolder(showcaseId),
      onProgress,
      signal,
    });
    if (recorded) {
      try {
        exportRecords.add({
          showcaseId,
          kind,
          file: out,
          fingerprint,
          durationMs,
          frames: Math.round((durationMs / 1000) * videoFps(kind)),
          renderMs: Date.now() - started,
        });
      } catch (error) {
        log(`studio: couldn't record the export of ${showcaseId} (${error.message})`);
      }
    }
    return out;
  }

  /* Every job change goes to every page as the "export" event — the job's
   * status (export-jobs.mjs), whether the page, the MCP tools, or
   * --export started it. */
  const exportJobs = createExportJobs(recordedExport, {
    onChange: (status) => emit("export", status),
  });

  /* ---------- media builds ---------- */

  /* Building a recorded pitch from its cut list (server/build-media.mjs):
   * the voiceover, the clips, the words file, and every scene's
   * durationMs, all derived from the spans in showcase.yaml. Its own job
   * lane, so a build and an export don't block each other, reported to
   * pages as the "build" event. */
  /* A showcase voiced by Polly (meta.voiceover, server/voiceover.mjs)
   * builds in the same lane: "voiceover" asks for it by name, and a plain
   * "build" of such a showcase — the Build media button — picks it. */
  const buildJobs = createExportJobs(
    (kind, showcaseId, { onProgress, signal, force, only }) =>
      (kind === "voiceover" || hasVoiceover(showcasesDir, showcaseId)
        ? buildVoiceover({
            showcasesDir,
            showcaseId,
            force,
            onProgress,
            signal,
            beforeWrite: recordSelfWrite,
          })
        : buildMedia({
            showcasesDir,
            showcaseId,
            force,
            only,
            onProgress,
            signal,
            beforeWrite: recordSelfWrite,
          })
      ).then((result) => {
        if (!result.ok) throw new Error(result.error);
        logUi(showcaseId, "build", {
          built: result.built,
          file: "showcase.yaml",
          version: result.version,
        });
        return result;
      }),
    { onChange: (status) => emit("build", status), name: "build", poll: "build_status" },
  );

  /** Opens the file manager on a showcase's exports: the job's output
   *  when `jobId` names a finished job, else the showcase's export
   *  folder. Paths come from the studio, never from the request. */
  function revealExport({ showcaseId, jobId } = {}) {
    const job = jobId ? exportJobs.status(String(jobId)) : undefined;
    if (job?.status === "done" && job.out && existsSync(job.out)) {
      reveal(job.out);
      return { ok: true, path: job.out };
    }
    const id = String(showcaseId ?? job?.showcaseId ?? "");
    if (!id || id !== path.basename(id) || id.startsWith(".")) {
      return { ok: false, error: `No showcase named "${id}"` };
    }
    const dir = exportFolder(id);
    if (!existsSync(dir)) return { ok: false, error: `${id} has no exports yet` };
    reveal(dir);
    return { ok: true, path: dir };
  }

  /* ---------- terminals and MCP ---------- */

  const terminals = terminalsOn
    ? createTerminals({
        getLibrary: () => showcasesDir,
        /* Facts every Claude session should have on hand, computed at
         * spawn so they track the running studio. .studio/GUIDE.md
         * explains each one. */
        getEnv: () => ({
          SHOWCASE_STUDIO_ROOT: showcasesDir,
          ...(sourceDir ? { SHOWCASE_STUDIO_SRC: sourceDir } : {}),
          ...(ffmpegPath ? { SHOWCASE_STUDIO_FFMPEG: ffmpegPath } : {}),
          ...(whisperPath() ? { SHOWCASE_STUDIO_WHISPER: whisperPath() } : {}),
        }),
        getMcpConfig: () => path.join(showcasesDir, ".studio", "mcp.json"),
        settings,
        emit,
      })
    : null;

  /* Every write made on someone's behalf — page actions here, MCP edits
   * in mcp.mjs — lands in <library>/.studio/changes.jsonl
   * (server/change-log.mjs), so a Claude session can follow the user's
   * edits, which the watcher above deliberately doesn't announce. */
  /* Commits each showcase's changes to git after a quiet period, when the
   * library is in a git repository. The watcher reports every file change
   * to it; logged writes report their showcase too, in case the watcher
   * misses one. */
  const history = createShowcaseHistory({
    getLibrary: () => showcasesDir,
    settings,
    autoCommitDefault: features.autoCommit !== false,
    delayMs: commitDelayMs,
    log,
  });
  const changeLog = createChangeLog(() => showcasesDir, {
    log,
    onAppend: (entry) => history.noteShowcase(entry.showcaseId, entry.kind),
  });

  const mcpContext = {
    info,
    license,
    createShowcase,
    getUrl: () => url,
    getShowcasesDir: () => showcasesDir,
    renderer,
    exportJobs,
    buildJobs,
    changeLog,
    history,
    share,
    openUrl,
    copyText,
    reveal,
  };
  const mcp = createMcpHandler({ version, context: mcpContext });

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
      emit("info", info());
    }
    return { ok: true, id };
  }

  /* Renames an asset file and updates every YAML reference to it — the
   * bare key and the full file name, in asset:/src:/cover: fields only,
   * so narration text mentioning the same word is left alone. Besides the
   * page's answer, returns the references it rewrote and showcase.yaml's
   * hash before and after, for the change log. */
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
    let references = [];
    let previousHash;
    let hash;
    const yamlPath = path.join(showcasesDir, id, "showcase.yaml");
    if (existsSync(yamlPath)) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const strip = (s) => s.replace(/\.[^.]+$/, "");
      const text = readFileSync(yamlPath, "utf8");
      /* The full file name and, when it has an extension, the bare key —
       * matched in one pass, so offsets point into the original text.
       * When files share a bare name, it means the first of them (see
       * assetMap in src/content/source.ts). So the bare key is rewritten
       * only when it means the renamed file, and it becomes the full new
       * name when the new bare name already means another file. */
      const files = readdirSync(dir).filter((f) => !f.startsWith("."));
      const means = (key, except) =>
        files.find((f) => f !== except && (f === key || strip(f) === key));
      const names = new Map([[oldName, newName]]);
      if (strip(oldName) !== oldName && means(strip(oldName)) === oldName) {
        const newKey = strip(newName);
        names.set(strip(oldName), means(newKey, oldName) ? newName : newKey);
      }
      const re = new RegExp(
        `(^\\s*(?:asset|src|cover):\\s*["']?)(${[...names.keys()].map(esc).join("|")})(["']?\\s*(?:#.*)?)$`,
        "gm",
      );
      const found = [];
      const next = text.replace(re, (_all, head, value, tail, offset) => {
        found.push({ at: offset + head.length, from: value, to: names.get(value) });
        return `${head}${names.get(value)}${tail}`;
      });
      if (found.length > 0) {
        references = locateReferences(text, found);
        previousHash = contentHash(text);
        hash = contentHash(next);
        writeFileSync(yamlPath, next);
      }
    }
    renameSync(path.join(dir, oldName), path.join(dir, newName));
    return {
      ok: true,
      name: newName,
      updatedReferences: references.length,
      references,
      previousHash,
      hash,
    };
  }

  /* Adds files to the showcase's assets/ folder — the drop target on the
   * assets page. All files arrive in one request (base64) and are all
   * written before the watcher's reload can interrupt; names are
   * de-duplicated (name-2.png), never overwritten. */
  /* The page's drop target: files arrive as base64 in the request. The
   * MCP add_asset tool writes the same folder from paths on disk; both
   * go through server/asset-files.mjs. */
  const addAssets = (body) => addAssetData(showcasesDir, body);

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
   * site's publish endpoint (cdk/lambda/publish-core.mjs). Anyone may
   * publish. The first publish gets back the link's token and an edit
   * key, saved in settings under the showcase folder's full path, so
   * publishing again updates the link the narrator already has:
   *
   *   prompterLinks: { "<showcase folder>": { token, editKey } }
   *
   * A folder that was moved or renamed keeps its link when exactly one
   * saved folder of the same name no longer exists. A link that can't be
   * updated any more (expired, or the key no longer matches) is replaced
   * by a new one, and the result says so. The endpoint defaults to the
   * production site; prompterPublishUrl in settings.json or
   * PROMPTER_PUBLISH_URL in the environment points it elsewhere. */
  async function publishPrompter({ showcaseId } = {}) {
    const id = String(showcaseId ?? "");
    if (badName(id)) return { ok: false, error: "Bad showcase id" };
    let folder;
    try {
      folder = realpathSync(path.join(showcasesDir, id));
    } catch {
      return { ok: false, error: `No showcase named "${id}"` };
    }
    const saved = settings.load();
    const publishUrl =
      process.env.PROMPTER_PUBLISH_URL ?? saved.prompterPublishUrl ?? PROMPTER_PUBLISH_URL;
    const links = { ...saved.prompterLinks };
    if (!links[folder]) {
      const moved = Object.keys(links).filter(
        (other) => path.basename(other) === id && !existsSync(other),
      );
      if (moved.length === 1) {
        links[folder] = links[moved[0]];
        delete links[moved[0]];
      }
    }
    const script = prompterScript(showcasesDir, id, { publishedAt: new Date().toISOString() });
    const post = async (body) => {
      const response = await fetch(publishUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return [response.status, await response.json().catch(() => ({}))];
    };

    let replaced = false;
    let [status, result] = links[folder]
      ? await post({ ...links[folder], script })
      : await post({ script });
    if (links[folder] && (status === 403 || status === 404)) {
      replaced = true;
      [status, result] = await post({ script });
    }
    if (status !== 200) {
      return { ok: false, error: result.error ?? `Publish failed (${status})` };
    }
    if (result.token) links[folder] = { token: result.token, editKey: result.editKey };
    settings.save({ prompterLinks: links });
    return { ok: true, url: result.url, replaced };
  }

  /** Switches the library folder (File > Open Folder in the desktop app).
   *  Remembered as the saved library and in Open Recent. A locked studio
   *  never switches. */
  async function setLibrary({ dir } = {}) {
    if (lock) return { ok: false, error: "This studio is locked to one showcase" };
    const target = path.resolve(String(dir ?? ""));
    if (!dir || !isDirectory(target)) return { ok: false, error: `${target} is not a folder` };
    const other = await runningStudio(target, { exceptUrl: url });
    if (other) return { ok: false, error: alreadyOpen(target, other.url) };
    release();
    showcasesDir = target;
    const recents = [target, ...(settings.load().recentFolders ?? []).filter((d) => d !== target)];
    settings.save({ showcasesDir: target, recentFolders: recents.slice(0, 8) });
    scaffold();
    watchLibrary();
    claiming = claim();
    emit("info", info());
    return { ok: true, library: target };
  }

  /* ---------- one studio per library (server/studio-presence.mjs) ---------- */

  /* The library this studio has recorded itself as having open. */
  let claimed = null;
  let claiming = Promise.resolve();

  /** Records this studio in the library's .studio/studio.json — unless a
   *  live studio already holds it, whose record must stand. (Starting
   *  anyway is the launcher's choice, e.g. a headless export; it just
   *  doesn't take the record over.) */
  async function claim() {
    if (!url) return;
    const library = showcasesDir;
    try {
      if (await runningStudio(library, { exceptUrl: url })) return;
      if (library !== showcasesDir) return; // switched while asking
      writePresence(library, { url });
      claimed = library;
    } catch (error) {
      log(`studio: couldn't record the studio in ${library} (${error.message})`);
    }
  }

  function release() {
    if (claimed) clearPresence(claimed, { url });
    claimed = null;
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

  /* ---------- sharing (server/share.mjs) ---------- */

  const shareAction = (work) => (body) => {
    try {
      return { ok: true, ...work(body ?? {}) };
    } catch (error) {
      return { ok: false, error: String(error?.message ?? error) };
    }
  };

  /** A recorded export's video, by the ids the page names — the path
   *  comes from the studio's own record, never from the request. */
  const exportVideo = (showcaseId, id) => {
    const record = exportRecords.get(String(showcaseId ?? ""), String(id ?? ""));
    if (!record) throw new Error(`No export "${id}" of "${showcaseId}" (was the file moved?)`);
    return record;
  };

  /** Streams a video with byte-range support: a <video> seeks by asking
   *  for ranges, and exports are too big to read whole per request. */
  function sendVideo(req, res, file) {
    const size = statSync(file).size;
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    res.setHeader("Content-Type", "video/mp4");
    res.setHeader("Accept-Ranges", "bytes");
    if (!match || (match[1] === "" && match[2] === "")) {
      res.setHeader("Content-Length", String(size));
      createReadStream(file).pipe(res);
      return;
    }
    const start = match[1] === "" ? Math.max(0, size - Number(match[2])) : Number(match[1]);
    const end =
      match[1] !== "" && match[2] !== "" ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader("Content-Range", `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${size}`);
    res.setHeader("Content-Length", String(end - start + 1));
    createReadStream(file, { start, end }).pipe(res);
  }

  const terminalAction = (method) => (body) =>
    terminals ? terminals[method](body) : { ok: false, error: "Terminals are off in this studio" };

  /** The "Commit changes to git" switch. Saved studio-wide in settings,
   *  and in effect at once: the history reads the setting before every
   *  commit. Turning it off also drops the commits still waiting for their
   *  quiet period. Logged as a "setting" change, so a Claude session
   *  following the change log hears about it. */
  async function setAutoCommit({ on } = {}) {
    if (typeof on !== "boolean") return { ok: false, error: "Send on: true or on: false" };
    settings.save({ autoCommit: on });
    if (!on) history.cancelPending();
    changeLog.append({
      source: "ui",
      showcaseId: null,
      kind: "setting",
      name: "autoCommit",
      value: on,
    });
    return { ok: true, history: await history.status() };
  }

  /* The actions that write a showcase's files log each successful write
   * as a "ui" change. */
  const logUi = (showcaseId, kind, details) =>
    changeLog.append({ source: "ui", showcaseId: String(showcaseId), kind, ...details });

  const ACTIONS = {
    "scene-edit": (body) => {
      const result = applySceneEditToFolder(showcasesDir, body, { beforeWrite: recordSelfWrite });
      if (result.ok) {
        logUi(body.showcaseId, "edit", {
          file: result.file,
          previousVersion: result.previousHash,
          version: result.hash,
          edits: [editForLog(body)],
        });
      }
      return result;
    },
    "showcase-create": ({ name }) => {
      const result = createShowcase(name);
      if (result.ok) logUi(result.id, "showcase.create", { title: String(name).trim() });
      return result;
    },
    "asset-rename": (body) => {
      const { references, previousHash, hash, ...result } = renameAsset(body);
      if (result.ok) {
        logUi(body.showcaseId, "asset.rename", {
          from: String(body.from),
          to: result.name,
          references,
          ...(hash ? { file: "showcase.yaml", previousVersion: previousHash, version: hash } : {}),
        });
      }
      return result;
    },
    "asset-add": (body) => {
      const result = addAssets(body);
      if (result.ok) logUi(body.showcaseId, "asset.add", { names: result.names });
      return result;
    },
    "asset-delete": (body) => {
      const result = deleteAsset(body);
      if (result.ok) logUi(body.showcaseId, "asset.delete", { name: String(body.name) });
      return result;
    },
    "prompter-publish": publishPrompter,
    "history-auto-commit": setAutoCommit,
    export: ({ kind, showcaseId }) => exportJob(String(kind ?? ""), showcaseId),
    "export-status": ({ jobId }) => {
      const job = exportJobs.status(String(jobId ?? ""));
      return job ? { ok: true, job } : { ok: false, error: `No export job named "${jobId}"` };
    },
    "export-cancel": ({ jobId }) => {
      const job = exportJobs.cancel(String(jobId ?? ""));
      return job ? { ok: true, job } : { ok: false, error: `No export job named "${jobId}"` };
    },
    "export-current": () => ({ ok: true, job: exportJobs.current() ?? null }),
    "license-status": async ({ refresh } = {}) => ({
      ok: true,
      status: await license.refresh({ force: refresh === true }),
    }),
    "license-checkout": () => license.startCheckout(),
    "license-checkout-cancel": () => license.cancelCheckout(),
    "license-key": ({ key } = {}) => license.enterKey(key),
    "license-portal": () => license.openPortal(),
    "license-remove": () => license.removeKey(),
    "license-key-get": () => ({ ok: true, key: license.savedKey() }),
    "export-reveal": revealExport,
    "share-status": shareAction(({ showcaseId }) => ({
      status: share.status(String(showcaseId ?? "")),
    })),
    /* A hand-off "from this computer" also opens the destination's
     * upload page in the user's browser; one "to the phone" opens the
     * AirDrop window on the video, where the Mac has one. Both run here,
     * on the studio's machine, so they work the same from the desktop
     * window, a browser, and Claude Code's preview. */
    "share-handoff": shareAction(({ showcaseId, destination, method, quality }) => {
      if (method === "phone" && !sendToPhone) {
        throw new Error("Sending to the phone needs AirDrop, which only a Mac has");
      }
      const result = share.handOff({
        showcaseId: String(showcaseId ?? ""),
        destination: String(destination ?? ""),
        method: String(method ?? ""),
        quality: quality == null ? "full" : String(quality),
      });
      if (result.record.method === "computer") openUrl(result.uploadUrl);
      if (result.record.method === "phone") sendToPhone(result.record.file);
      return { handoff: result.record, uploadUrl: result.uploadUrl };
    }),
    /* The page copies with the browser's clipboard; an embedded preview
     * may refuse it, so the studio copies instead. */
    "share-copy": async ({ text }) => {
      if (typeof text !== "string") return { ok: false, error: "Nothing to copy" };
      return (await copyText(text))
        ? { ok: true }
        : { ok: false, error: "No clipboard program here (install wl-copy or xclip)" };
    },
    "share-post-link": shareAction(({ showcaseId, destination, url: link, handoffId }) => ({
      handoff: share.recordPostUrl({
        showcaseId: String(showcaseId ?? ""),
        destination: destination == null ? undefined : String(destination),
        url: link,
        handoffId: handoffId == null ? undefined : String(handoffId),
      }),
    })),
    /* Only a link the studio kept (checked to be on the platform's site)
     * is opened — never a URL from the request. */
    "share-open-post": shareAction(({ showcaseId, handoffId }) => {
      const handoff = share.handoff(String(showcaseId ?? ""), String(handoffId ?? ""));
      if (!handoff?.postUrl) throw new Error("That hand-off has no post link");
      openUrl(handoff.postUrl);
      return {};
    }),
    "share-reveal": shareAction(({ showcaseId, exportId }) => {
      const record = exportVideo(showcaseId, exportId);
      reveal(record.file);
      return { path: record.file };
    }),
    build: ({ showcaseId, force, only }) => {
      try {
        return {
          ok: true,
          job: buildJobs.start("build", String(showcaseId ?? ""), {
            force: force === true,
            only: Array.isArray(only) ? only.map(String) : undefined,
          }),
        };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    voiceover: ({ showcaseId, force }) => {
      try {
        return {
          ok: true,
          job: buildJobs.start("voiceover", String(showcaseId ?? ""), { force: force === true }),
        };
      } catch (error) {
        return { ok: false, error: String(error?.message ?? error) };
      }
    },
    "build-cancel": ({ jobId }) => {
      const job = buildJobs.cancel(String(jobId ?? ""));
      return job ? { ok: true, job } : { ok: false, error: `No build job named "${jobId}"` };
    },
    "build-current": () => ({ ok: true, job: buildJobs.current() ?? null }),
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
      const isData = pathname === "/showcase-data" || pathname.startsWith("/showcase-data/");
      const isApi = pathname.startsWith("/studio/api/");
      if (!isData && !isApi && pathname !== "/mcp") {
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
      if (isData) {
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
      if (pathname === "/mcp") {
        await mcp(req, res);
        return;
      }
      const action = pathname.slice("/studio/api/".length);
      if (req.method === "GET" && action === "info") {
        sendJson(res, 200, info());
        return;
      }
      if (req.method === "GET" && action === "history") {
        sendJson(res, 200, await history.status());
        return;
      }
      if (req.method === "GET" && action === "events") {
        openEventStream(req, res);
        return;
      }
      if (req.method === "GET" && action === "export-video") {
        const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        let record;
        try {
          record = exportVideo(query.get("showcase"), query.get("id"));
        } catch (error) {
          sendJson(res, 404, { ok: false, error: error.message });
          return;
        }
        sendVideo(req, res, record.file);
        return;
      }
      if (req.method === "GET" && action === "frame") {
        const query = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
        const showcaseId = query.get("showcase") ?? "";
        const view = query.get("view") === "43" ? "43" : "tiktok";
        const atMs = Number(query.get("at"));
        const result = await screenshotFrame(renderer, url, showcasesDir, {
          showcaseId,
          atMs: query.get("at") == null ? undefined : atMs,
          view,
          safeArea: query.get("safeArea") === "1",
          size: "full",
        });
        const png = Buffer.from(result.frames[0].png, "base64");
        res.writeHead(200, {
          "Content-Type": "image/png",
          "Content-Length": String(png.length),
          "Content-Disposition": `attachment; filename="${frameFileName(showcaseId, view, atMs)}"`,
        });
        res.end(png);
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

    /** Records where the studio is served (once its server listens) and
     *  rewrites .studio/mcp.json to match. */
    setUrl(next) {
      url = String(next).replace(/\/$/, "");
      writeMcpConfig();
      claiming = claim();
    },

    /** The library's git history facts (server/showcase-history.mjs status()). */
    historyStatus: () => history.status(),

    /** Runs one MCP tool in-process (the studio Claude Code starts). */
    callTool: (params) => callTool(mcpContext, params),

    /** Runs one export now and resolves with its output (--export). */
    exportNow: (kind, showcaseId, { onProgress } = {}) =>
      recordedExport(kind, showcaseId, { onProgress }),

    async close() {
      unregisterStudio();
      license.close();
      await claiming;
      release();
      if (watcher) {
        /* fs.watch's close() returns before the handle is released; the
         * "close" event follows. A test deleting the library right after
         * this would otherwise find it still open on Windows. */
        const closed = new Promise((resolve) => watcher.once("close", resolve));
        watcher.close();
        await closed;
      }
      /* A reload still waiting would fire after close. */
      clearTimeout(reloadTimer);
      await codeWatch?.close();
      await history.close();
      terminals?.dispose();
      for (const res of listeners) res.end();
      listeners.clear();
      await renderer?.dispose?.();
    },
  };
}
