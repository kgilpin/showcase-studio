/* Runs the desktop shell against a dev server:
 *
 *   1. Starts vite dev on port 8092 in data mode, pointed at the
 *      shell's folder server (127.0.0.1:8123).
 *   2. Waits for it to answer, then launches Electron (electron/main.mjs),
 *      which serves ~/Showcases (or SHOWCASES_DIR) on that port and opens
 *      the window.
 *
 * Usage:  npm run electron:dev
 * Env:    SHOWCASES_DIR (default ~/Showcases), ELECTRON_SMOKE (see main.mjs)
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const appPort = 8092;
const dataUrl = `http://127.0.0.1:${process.env.SHOWCASES_PORT ?? 8123}`;

const vite = spawn("npm", ["run", "dev", "--", "--port", String(appPort), "--strictPort"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, VITE_SHOWCASES_URL: dataUrl },
});

async function waitFor(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(2000) });
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${url}`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

try {
  await waitFor(`http://localhost:${appPort}`);
  const electron = spawn("npx", ["electron", "electron/main.mjs"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, ELECTRON_APP_URL: `http://localhost:${appPort}` },
  });
  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
  // Take Electron down with us — otherwise a killed dev.mjs leaves a
  // stray instance holding the data port.
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
    process.on(signal, () => {
      electron.kill();
      vite.kill();
      process.exit(0);
    });
  }
} catch (error) {
  vite.kill();
  throw error;
}
