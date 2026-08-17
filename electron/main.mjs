/* Electron shell: the showcase app as a desktop studio.
 *
 * On launch it:
 *   1. Ensures the user's showcases folder exists (~/Showcases, or
 *      SHOWCASES_DIR), seeding it from src/showcases/ on first run so
 *      the app opens with content.
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
import { cpSync, existsSync, mkdirSync, watch, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleShowcaseRequest, showcaseIndex } from "../scripts/showcase-data.mjs";
import { exportScreens, exportVideo } from "./exporter.mjs";
import { registerAgent } from "./agent.mjs";
import { registerTerminal } from "./terminal.mjs";
import { loadSettings, saveSettings } from "./settings.mjs";
import { SHOWCASE_GUIDE } from "./showcase-guide.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
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

function ensureShowcasesDir(seedContent = true) {
  mkdirSync(showcasesDir, { recursive: true });
  if (seedContent && showcaseIndex(showcasesDir).showcases.length === 0) {
    const seed = path.join(repoRoot, "src/showcases");
    if (existsSync(seed)) cpSync(seed, showcasesDir, { recursive: true });
  }
  // Make the folder self-describing and git-friendly, without clobbering.
  if (!existsSync(path.join(showcasesDir, "README.md"))) {
    writeFileSync(path.join(showcasesDir, "README.md"), FOLDER_README);
  }
  if (!existsSync(path.join(showcasesDir, ".gitignore"))) {
    writeFileSync(path.join(showcasesDir, ".gitignore"), ".DS_Store\n");
  }
  /* CLAUDE.md teaches any Claude Code session in this folder the showcase
   * model — including the studio's embedded terminal. */
  if (!existsSync(path.join(showcasesDir, "CLAUDE.md"))) {
    writeFileSync(
      path.join(showcasesDir, "CLAUDE.md"),
      `# Showcase authoring guide

This folder is a Showcase Studio library: auto-playing, video-style
product tours defined as data. The studio app live-reloads whenever a
file here changes, so edits appear immediately.

${SHOWCASE_GUIDE}

Exports (App Store screenshots, MP4 renders) are run from the studio's
export page — ask the user to trigger them there.
`,
    );
  }
}

function serveData() {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    res.setHeader("Access-Control-Allow-Origin", "*");
    handleShowcaseRequest(showcasesDir, url).then(
      (result) => {
        if (!result) {
          res.statusCode = 404;
          res.end("not found");
          return;
        }
        res.statusCode = result.status;
        res.setHeader("Content-Type", result.type);
        res.end(result.body);
      },
      (error) => {
        res.statusCode = 500;
        res.end(String(error));
      },
    );
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

/** Menu → Choose Showcases Folder…: point the studio at any directory —
 *  typically a git repo the user manages. Persisted across launches. */
async function chooseShowcasesFolder(win) {
  const picked = await dialog.showOpenDialog(win, {
    title: "Choose Showcases Folder",
    buttonLabel: "Use Folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: showcasesDir,
  });
  const dir = picked.filePaths[0];
  if (picked.canceled || !dir) return;
  showcasesDir = dir;
  saveSettings({ showcasesDir: dir });
  let seed = false;
  if (showcaseIndex(dir).showcases.length === 0) {
    const answer = await dialog.showMessageBox(win, {
      type: "question",
      message: "This folder has no showcases yet.",
      detail: "Copy the sample showcases into it, or start empty?",
      buttons: ["Copy Samples", "Start Empty"],
      defaultId: 0,
    });
    seed = answer.response === 0;
  }
  ensureShowcasesDir(seed);
  watchShowcases(win);
  win.webContents.reloadIgnoringCache();
}

function buildMenu(win) {
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        { label: "Choose Showcases Folder…", click: () => void chooseShowcasesFolder(win) },
        { label: "Reveal Showcases Folder", click: () => void shell.openPath(showcasesDir) },
        ...(process.platform === "darwin" ? [] : [{ type: "separator" }, { role: "quit" }]),
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** Runs one export, streaming progress to the studio window when open. */
async function runExport(kind, showcaseId, win) {
  const progress = (label) => {
    win?.webContents.send("export-progress", { showcaseId, kind, label });
    if (process.env.ELECTRON_EXPORT) console.log(`${kind} ${showcaseId}: ${label}`);
  };
  const outDir = path.join(app.getPath("downloads"), "showcase-exports", showcaseId);
  const options = { showcasesDir, showcaseId, appUrl, outDir, progress };
  const out =
    kind === "screens"
      ? await exportScreens(options)
      : await exportVideo({ ...options, fps: Number(process.env.EXPORT_FPS ?? 30) });
  win?.webContents.send("export-progress", { showcaseId, kind, label: "done", done: true, out });
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

  registerAgent(ipcMain, win, {
    showcasesDir: () => showcasesDir,
    runExport: (kind, showcaseId) => runExport(kind, showcaseId, win),
  });
  const terminal = registerTerminal(ipcMain, win, { getCwd: () => showcasesDir });
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
            "smoke agent status:",
            JSON.stringify(await exec("window.showcaseStudio.agent.status()")),
          );
          console.log(
            "smoke terminal available:",
            JSON.stringify(await exec("window.showcaseStudio.terminal.available()")),
          );
          await exec(`document.querySelector('[aria-label="Open the studio agent"]')?.click()`);
          // Give the terminal (Claude Code boot) time to render before capturing.
          await new Promise((r) => setTimeout(r, 4000));
        }
        const image = await win.webContents.capturePage();
        writeFileSync(process.env.ELECTRON_SMOKE, image.toPNG());
        console.log(`smoke: captured ${process.env.ELECTRON_SMOKE} from ${appUrl}`);
      } catch (error) {
        console.error("smoke failed:", error);
      }
      app.quit();
    }, 4000);
  }
});

app.on("window-all-closed", () => app.quit());
