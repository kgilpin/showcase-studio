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
import { existsSync, mkdirSync, watch, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { handleShowcaseRequest, showcaseIndex } from "../scripts/showcase-data.mjs";
import { exportScreens, exportVideo } from "./exporter.mjs";
import { registerTerminal } from "./terminal.mjs";
import { loadSettings, saveSettings } from "./settings.mjs";
import { SHOWCASE_GUIDE } from "./showcase-guide.mjs";

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
 * samples live in the app repo, and the "+" card creates real content. */
function ensureShowcasesDir() {
  mkdirSync(showcasesDir, { recursive: true });
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

Claude Code sessions opened by the studio start inside a specific
showcase's folder — paths are then relative to that showcase
(showcase.yaml, assets/, graphics/). The library root is one level up.

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

/* The File menu's Export items act on the showcase currently on screen —
 * the renderer reports route changes over IPC ("menu-showcase"), and the
 * menu is rebuilt so the items enable/disable to match. */
let currentShowcaseId = null;
let exporting = false;

async function runMenuExport(kind, win) {
  const showcaseId = currentShowcaseId;
  if (!showcaseId || exporting) return;
  exporting = true;
  buildMenu(win);
  try {
    shell.showItemInFolder(await runExport(kind, showcaseId, win));
  } catch (error) {
    dialog.showErrorBox("Export failed", String(error?.message ?? error));
  } finally {
    exporting = false;
    buildMenu(win);
  }
}

function buildMenu(win) {
  const home = app.getPath("home");
  const recents = (loadSettings().recentFolders ?? []).filter((dir) => dir !== showcasesDir);
  const exportItem = (label, kind) => ({
    label,
    enabled: Boolean(currentShowcaseId) && !exporting,
    click: () => void runMenuExport(kind, win),
  });
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
        { type: "separator" },
        exportItem("Export App Screens", "screens"),
        exportItem("Export Video", "video"),
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

  /* The renderer reports which showcase is on screen so the File menu's
   * Export items can target it (and gray out on the list pages). */
  ipcMain.on("menu-showcase", (_event, id) => {
    const next = typeof id === "string" && id ? id : null;
    if (next === currentShowcaseId) return;
    currentShowcaseId = next;
    buildMenu(win);
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
