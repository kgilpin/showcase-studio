/* Electron shell: the showcase app as a desktop studio.
 *
 * On launch it:
 *   1. Ensures the user's showcases folder exists (~/Showcases, or
 *      SHOWCASES_DIR), scaffolding README/.gitignore/CLAUDE.md on first
 *      run — showcases are created in-app, not seeded from samples.
 *   2. Serves that folder on 127.0.0.1:8123 in the data shape the app's
 *      httpSource consumes (scripts/showcase-data.mjs), with CORS open
 *      so the app can fetch it from the dev-server origin.
 *   3. Opens a window on ELECTRON_APP_URL — a vite dev server started
 *      with VITE_SHOWCASES_URL=http://127.0.0.1:8123 (npm run
 *      electron:dev wires both up; a packaged build will load the built
 *      SPA shell instead).
 *   4. Watches the folder and reloads the window when anything changes.
 *
 * ELECTRON_SMOKE=<path.png> captures the loaded window to a file and
 * quits — used for automated verification.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import http from "node:http";
import { appendFileSync, existsSync, mkdirSync, readFileSync, watch, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleShowcaseRequest, showcaseIndex } from "../scripts/showcase-data.mjs";
import { exportScreens, exportVideo } from "./exporter.mjs";
import { registerTerminal } from "./terminal.mjs";
import { loadSettings, saveSettings } from "./settings.mjs";
import { createExportJobs } from "./export-jobs.mjs";
import { createMcpHandler } from "./mcp.mjs";
import { whisperPath } from "./transcribe.mjs";
import { studioGuide } from "./showcase-guide.mjs";

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

const dataPort = Number(process.env.SHOWCASES_PORT ?? 8123);
const appUrl = process.env.ELECTRON_APP_URL ?? "http://localhost:8092";

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
  writeFileSync(
    path.join(showcasesDir, ".studio", "GUIDE.md"),
    studioGuide({ version: appVersion, srcDir: repoRoot, ffmpegPath, showcasesDir }),
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
  const claudeMdPath = path.join(showcasesDir, "CLAUDE.md");
  if (!existsSync(claudeMdPath)) {
    writeFileSync(
      claudeMdPath,
      `# Showcases folder

${GUIDE_IMPORT}

The line above imports the studio's always-current instructions
(regenerated on every launch — keep it). The rest of this file is yours:
add notes specific to this library below, and the studio won't touch them.
`,
    );
  } else if (!readFileSync(claudeMdPath, "utf8").includes(GUIDE_IMPORT)) {
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
  const mcp = createMcpHandler({
    appUrl,
    version: appVersion,
    getShowcasesDir: () => showcasesDir,
    exportJobs,
  });
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url === "/mcp") {
      void mcp(req, res);
      return;
    }
    handleShowcaseRequest(showcasesDir, url, { range: req.headers.range }).then(
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
  server.on("error", (error) => {
    // Fail loudly — a silent EADDRINUSE (e.g. a stray instance) otherwise
    // leaves the app serving stale data from the old process.
    console.error(`Showcase data server failed on port ${dataPort}: ${error.message}`);
    app.exit(1);
  });
  server.listen(dataPort, "127.0.0.1");
  return server;
}

let watcher;
function watchShowcases(win) {
  watcher?.close();
  let timer;
  watcher = watch(showcasesDir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => win.webContents.reloadIgnoringCache(), 250);
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
  win.webContents.reloadIgnoringCache();
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
  const recents = (loadSettings().recentFolders ?? []).filter((dir) => dir !== showcasesDir);
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
 *  Kinds: screens, video, video-draft (12fps, half size — a fast check). */
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
  const out =
    kind === "screens"
      ? await exportScreens(options)
      : kind === "video-draft"
        ? await exportVideo({ ...options, draft: true, fps: Number(process.env.EXPORT_FPS ?? 12) })
        : await exportVideo({ ...options, fps: Number(process.env.EXPORT_FPS ?? 30) });
  if (win && !win.isDestroyed()) {
    win.webContents.send("export-progress", { showcaseId, kind, label: "done", done: true, out });
  }
  return out;
}

app.whenReady().then(async () => {
  ensureShowcasesDir();
  serveData();

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
    theme: title
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
