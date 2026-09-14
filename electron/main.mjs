/* Electron shell: Showcase Studio as a desktop app.
 *
 * Electron is packaging, not features. Every studio feature lives in the
 * studio server (server/studio-server.mjs), and this window is one more
 * client of it, like a browser tab. What Electron adds: the window, the
 * system menus (File > Open Folder…, Open Recent, Reveal in Finder), the
 * Dock icon, the real path of files dropped on the terminal
 * (preload.cjs), and — in the packaged app — Electron's page renderer for
 * screenshots and exports (renderer.mjs).
 *
 * Two ways it runs:
 *   npm run dev:electron   scripts/dev.mjs starts the studio in the Vite dev
 *                          server and opens this window on it (--app-url).
 *   the packaged app       no --app-url: this process starts the studio
 *                          itself — the built app (.output/, npm run
 *                          build:desktop) behind a small server that mounts
 *                          the studio server, on free ports.
 *
 * `--help` lists the options (server/launch-options.mjs).
 *
 * ELECTRON_SMOKE=<path.png> captures the loaded window to a file and
 * quits — used for automated verification (ELECTRON_SMOKE_* below add
 * steps).
 */
import { app, BrowserWindow, dialog, Menu, shell } from "electron";
import http from "node:http";
import net from "node:net";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { STUDIO_USAGE, studioOptions } from "../server/launch-options.mjs";
import { showInRecent } from "../server/library-config.mjs";
import { loadSettings, saveSettings } from "../server/settings.mjs";
import { showcaseIndex } from "../server/showcase-data.mjs";
import { createStudio } from "../server/studio-server.mjs";
import { isPathInLock, lockLandingPath } from "../src/lib/window-lock.mjs";
import { createElectronRenderer } from "./renderer.mjs";

/* In dev the macOS menu-bar TITLE still reads "Electron" (it comes from
 * the binary's Info.plist and can't change at runtime — a packaged build
 * fixes it), but the items inside (About/Hide/Quit …) follow app.name. */
app.setName("Showcase Studio");

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require_ = createRequire(import.meta.url);
/* In dev app.getVersion() reports Electron's own version — the app's
 * version lives in package.json. */
const appVersion = require_("../package.json").version;

/* Command-line options. npm runs scripts from the package root, so
 * relative paths resolve against where npm was started (INIT_CWD).
 * --help prints the options and quits; a bad option is printed with
 * them, then reported in a dialog once the app is ready. The library
 * defaults to the saved folder (File > Open Folder…), then ~/Showcases. */
const savedOrHomeDir = loadSettings().showcasesDir ?? path.join(app.getPath("home"), "Showcases");
let options;
let launchError = null;
try {
  options = studioOptions(process.argv, {
    cwd: process.env.INIT_CWD ?? process.cwd(),
    defaultDir: savedOrHomeDir,
  });
} catch (error) {
  launchError = error.message;
  console.error(`${launchError}\n\n${STUDIO_USAGE}`);
  options = studioOptions([], { defaultDir: savedOrHomeDir });
}
if (options.help) {
  process.stdout.write(STUDIO_USAGE);
  process.exit(0);
}

/* The studio's address: given by npm run dev:electron, or set once the
 * packaged app's server listens. */
let appUrl = options.appUrl ?? null;
/** The packaged app's own studio (none when the window shows a dev server's). */
let studio;
/* What the window knows about its studio — the library folder and the
 * lock — kept current from the studio's events. */
let studioInfo = { library: options.showcasesDir, lock: options.lock };

const builtServer = path.join(repoRoot, ".output", "server", "index.mjs");

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

/** Streams a request the studio doesn't handle through to the built app server. */
function proxyToBuiltApp(appPort, req, res) {
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

/** The packaged app: starts the built app server and, in front of it, a
 *  small server that mounts the studio. Both take free ports. */
async function startPackagedStudio() {
  if (!existsSync(builtServer)) {
    throw new Error(
      "The built app is missing (.output/). Run `npm run build:desktop`, " +
        "or use `npm run dev:electron` from source.",
    );
  }
  const appPort = await freePort();
  /* The built app server (Nitro) reads its address from PORT and HOST. */
  process.env.PORT = String(appPort);
  process.env.HOST = "127.0.0.1";
  await import(pathToFileURL(builtServer).href);
  studio = createStudio({
    showcasesDir: options.showcasesDir,
    lock: options.lock,
    version: appVersion,
    srcDir: repoRoot,
    renderer: createElectronRenderer(),
  });
  const front = http.createServer(
    (req, res) => void studio.handle(req, res, () => proxyToBuiltApp(appPort, req, res)),
  );
  await new Promise((resolve, reject) => {
    front.once("error", reject);
    front.listen(0, "127.0.0.1", resolve);
  });
  appUrl = `http://127.0.0.1:${front.address().port}`;
  studio.setUrl(appUrl);
  console.log(`studio: ${appUrl}`);
}

async function readStudioInfo() {
  const response = await fetch(`${appUrl}/studio/api/info`);
  if (!response.ok) throw new Error(`the studio answered ${response.status}`);
  return response.json();
}

async function studioApi(action, body) {
  const response = await fetch(`${appUrl}/studio/api/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

/** Follows the studio's events for as long as the app runs, calling
 *  `onInfo` when the studio's info changes (a new lock, another library). */
async function followStudioEvents(onInfo) {
  for (;;) {
    try {
      const response = await fetch(`${appUrl}/studio/api/events`);
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body) {
        buffer += decoder.decode(chunk, { stream: true });
        for (let end = buffer.indexOf("\n\n"); end >= 0; end = buffer.indexOf("\n\n")) {
          const block = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event === "info" && data) onInfo(JSON.parse(data));
        }
      }
    } catch {
      /* the studio is restarting or gone — try again shortly */
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/* The lock's backstop. The page already redirects navigations outside the
 * lock (src/routes/__root.tsx); this catches whatever gets past it — full
 * page loads, in-page history changes, window.open, and any way of
 * switching showcases added later — and puts the window back on its
 * locked page. Links to other sites don't switch showcases, so they pass. */
function guardWindowLock(win) {
  const outsideLock = (url) => {
    if (!studioInfo.lock) return false;
    try {
      const target = new URL(url);
      return (
        target.origin === new URL(appUrl).origin && !isPathInLock(studioInfo.lock, target.pathname)
      );
    } catch {
      return false;
    }
  };
  const backToLock = () => void win.loadURL(appUrl + lockLandingPath(studioInfo.lock));
  win.webContents.on("will-navigate", (event, url) => {
    if (!outsideLock(url)) return;
    event.preventDefault();
    backToLock();
  });
  win.webContents.on("did-navigate", (_event, url) => {
    if (outsideLock(url)) backToLock();
  });
  win.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame && outsideLock(url)) backToLock();
  });
  win.webContents.setWindowOpenHandler(({ url }) =>
    outsideLock(url) ? { action: "deny" } : { action: "allow" },
  );
}

/** Points the studio at another library folder. The studio remembers it
 *  (saved folder, Open Recent) and the page goes home on its own. */
async function openLibrary(dir) {
  const result = await studioApi("library", { dir }).catch((error) => ({
    ok: false,
    error: error.message,
  }));
  if (!result.ok) {
    dialog.showErrorBox("Showcase Studio", result.error ?? "The folder could not be opened");
  }
}

/** File → Open Folder…: the directory picker in front of openLibrary. */
async function chooseShowcasesFolder(win) {
  const picked = await dialog.showOpenDialog(win, {
    title: "Open Showcases Folder",
    buttonLabel: "Open Folder",
    properties: ["openDirectory", "createDirectory"],
    defaultPath: studioInfo.library,
  });
  const dir = picked.filePaths[0];
  if (picked.canceled || !dir) return;
  await openLibrary(dir);
}

function buildMenu(win) {
  const home = app.getPath("home");
  /* A folder can opt out of Open Recent with show_in_recent: false in a
   * root-level showcase.yaml (server/library-config.mjs). It stays in the
   * saved list — flipping the setting back brings it back. */
  const recents = (loadSettings().recentFolders ?? []).filter(
    (dir) => dir !== studioInfo.library && showInRecent(dir),
  );
  /* Both items switch libraries, so a locked studio doesn't get them. */
  const switchingItems = studioInfo.lock
    ? []
    : [
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
              click: () => void openLibrary(dir),
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
      ];
  const revealDir =
    studioInfo.lock?.kind === "showcase"
      ? path.join(studioInfo.library, studioInfo.lock.showcaseId)
      : studioInfo.library;
  const template = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        ...switchingItems,
        {
          label: process.platform === "darwin" ? "Reveal in Finder" : "Show in File Manager",
          click: () => void shell.openPath(revealDir),
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

app.whenReady().then(async () => {
  if (launchError) {
    dialog.showErrorBox("Showcase Studio", launchError);
    app.exit(1);
    return;
  }
  if (!appUrl) {
    try {
      await startPackagedStudio();
    } catch (error) {
      dialog.showErrorBox("Showcase Studio", `The studio failed to start: ${error.message}`);
      app.exit(1);
      return;
    }
  }

  /* Export without a window (also the automated-test hook):
   * --export screens:<id> or --export video:<id> runs it and quits. */
  if (options.exportJob) {
    const { kind, showcaseId } = options.exportJob;
    try {
      if (!studio) throw new Error("--export runs in the packaged app (from source: npm run dev)");
      const out = await studio.exportNow(kind, showcaseId, {
        onProgress: (label) => console.log(`${kind} ${showcaseId}: ${label}`),
      });
      console.log(`exported: ${out}`);
      await studio.close();
      app.exit(0);
    } catch (error) {
      console.error(error);
      app.exit(1);
    }
    return;
  }

  try {
    studioInfo = await readStudioInfo();
  } catch (error) {
    dialog.showErrorBox(
      "Showcase Studio",
      `The studio at ${appUrl} isn't answering: ${error.message}`,
    );
    app.exit(1);
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

  /* A file dropped outside a drop target must not navigate the app to
   * file:// (Chromium's default) — that would blank the studio. */
  win.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file:")) event.preventDefault();
  });
  guardWindowLock(win);
  buildMenu(win);
  void followStudioEvents((next) => {
    const changed =
      next.library !== studioInfo.library ||
      JSON.stringify(next.lock) !== JSON.stringify(studioInfo.lock);
    studioInfo = next;
    if (changed && !win.isDestroyed()) buildMenu(win);
  });

  try {
    await win.loadURL(
      appUrl +
        (process.env.ELECTRON_SMOKE_PATH ??
          (studioInfo.lock ? lockLandingPath(studioInfo.lock) : "")),
    );
  } catch (error) {
    /* ERR_ABORTED: a newer load replaced this one — the lock guard
     * sending a smoke path outside the lock back to the locked page. */
    if (error.code !== "ERR_ABORTED") {
      console.error(`Failed to load ${appUrl}:`, error.message ?? error);
      if (process.env.ELECTRON_SMOKE) app.exit(1);
    }
  }

  if (process.env.ELECTRON_SMOKE) {
    setTimeout(async () => {
      try {
        const exec = (code) => win.webContents.executeJavaScript(code);
        /* Routes are client-only (ssr: false) — on a cold dev server
         * hydration can outlast any fixed delay, so wait for real content
         * (up to 15s) before doing anything else. */
        await exec(`(async () => {
          for (let i = 0; i < 150 && !document.body.innerText.trim(); i++) {
            await new Promise((r) => setTimeout(r, 100));
          }
        })()`);
        /* ELECTRON_SMOKE_EDIT=1 exercises in-app editing end to end: a
         * scenes.edit through the studio client must land in showcase.yaml,
         * and the watcher must swallow its echo (no page reload). */
        if (process.env.ELECTRON_SMOKE_EDIT) {
          const first = showcaseIndex(studioInfo.library).showcases[0];
          const yamlPath = path.join(studioInfo.library, first.id, "showcase.yaml");
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
         * snapshot and logs the share URL — needs the publish endpoint
         * configured (settings or env). */
        if (process.env.ELECTRON_SMOKE_SHARE) {
          const first = showcaseIndex(studioInfo.library).showcases[0];
          const shared = await exec(
            `window.showcaseStudio.prompter.publish(${JSON.stringify(first.id)})`,
          );
          console.log("smoke share:", JSON.stringify(shared));
        }
        /* ELECTRON_SMOKE_AGENT=1 exercises the terminal: reports whether
         * it's available and opens the panel so the capture shows it. */
        if (process.env.ELECTRON_SMOKE_AGENT) {
          console.log(
            "smoke terminal available:",
            JSON.stringify(await exec("window.showcaseStudio.terminal.available()")),
          );
          if (!process.env.ELECTRON_SMOKE_MENU) {
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
           * studio's reload, which can strand in-flight executeJavaScript
           * calls, hence the race. */
          const created = await Promise.race([
            exec(`window.showcaseStudio.showcases.create("Flow Test")`),
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

app.on("before-quit", () => void studio?.close());
app.on("window-all-closed", () => app.quit());
