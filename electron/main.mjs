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
import { app, BrowserWindow } from "electron";
import http from "node:http";
import { cpSync, existsSync, mkdirSync, readFileSync, watch } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { MIME, showcaseFile, showcaseIndex } from "../scripts/showcase-data.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataPort = Number(process.env.SHOWCASES_PORT ?? 8123);
const appUrl = process.env.ELECTRON_APP_URL ?? "http://localhost:8092";

const showcasesDir = process.env.SHOWCASES_DIR ?? path.join(app.getPath("home"), "Showcases");

function ensureShowcasesDir() {
  if (existsSync(showcasesDir) && showcaseIndex(showcasesDir).showcases.length > 0) return;
  mkdirSync(showcasesDir, { recursive: true });
  const seed = path.join(repoRoot, "src/showcases");
  if (existsSync(seed)) {
    cpSync(seed, showcasesDir, {
      recursive: true,
      filter: (src) => !src.includes(`${path.sep}graphics`),
    });
  }
}

function serveData() {
  const server = http.createServer((req, res) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (url === "/index.json") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(showcaseIndex(showcasesDir)));
      return;
    }
    const file = showcaseFile(showcasesDir, url);
    if (!file) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", MIME[path.extname(file)] ?? "application/octet-stream");
    res.end(readFileSync(file));
  });
  server.listen(dataPort, "127.0.0.1");
  return server;
}

function watchShowcases(win) {
  let timer;
  watch(showcasesDir, { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => win.webContents.reloadIgnoringCache(), 250);
  });
}

app.whenReady().then(async () => {
  ensureShowcasesDir();
  serveData();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Showcase Studio",
    show: !process.env.ELECTRON_SMOKE,
  });
  await win.loadURL(appUrl);
  watchShowcases(win);

  if (process.env.ELECTRON_SMOKE) {
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.ELECTRON_SMOKE, image.toPNG());
      console.log(`smoke: captured ${process.env.ELECTRON_SMOKE} from ${appUrl}`);
      app.quit();
    }, 4000);
  }
});

app.on("window-all-closed", () => app.quit());
