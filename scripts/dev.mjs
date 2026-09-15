/* The studio from source:
 *
 *   npm run dev            the full studio, in your browser
 *   npm run dev:electron   the same studio, in an Electron window (adds the
 *                          system menus)
 *
 * (Claude Code starts a studio of its own through .mcp.json —
 * scripts/studio-mcp.mjs.)
 *
 * The port is PORT when a launcher sets it, otherwise a free one; the URL
 * is printed as "studio: <url>". `npm run dev -- --help` lists the options.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { STUDIO_USAGE, studioOptions } from "../server/launch-options.mjs";
import { repoRoot, startDevStudio } from "./dev-studio.mjs";

let options;
try {
  options = studioOptions(process.argv.slice(2), {
    /* npm runs scripts from the package root; paths are relative to where
     * npm was started. */
    cwd: process.env.INIT_CWD ?? process.cwd(),
    defaultDir: path.join(repoRoot, "showcases"),
  });
  if (options.unknown.length > 0) {
    throw new Error(`Unknown option: ${options.unknown.join(" ")}`);
  }
  if (options.appUrl) {
    throw new Error("--app-url is for the Electron window; the dev server starts its own studio.");
  }
} catch (error) {
  console.error(`${error.message}\n\n${STUDIO_USAGE}`);
  process.exit(2);
}
if (options.help) {
  process.stdout.write(STUDIO_USAGE);
  process.exit(0);
}

const running = await startDevStudio({
  showcasesDir: options.showcasesDir,
  lock: options.lock,
  features: { terminal: options.terminal },
  port: Number(process.env.PORT) || undefined,
});
console.log(`studio: ${running.landingUrl()}`);

let electron;
let closing = false;
async function shutdown(code) {
  if (closing) return;
  closing = true;
  electron?.kill();
  await running.close();
  process.exit(code);
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => void shutdown(0));
}

if (options.exportJob) {
  const { kind, showcaseId } = options.exportJob;
  try {
    const out = await running.studio.exportNow(kind, showcaseId, {
      onProgress: (label) => console.log(`${kind} ${showcaseId}: ${label}`),
    });
    console.log(`exported: ${out}`);
    await shutdown(0);
  } catch (error) {
    console.error(error);
    await shutdown(1);
  }
}

if (options.electron) {
  const electronBinary = createRequire(import.meta.url)("electron");
  electron = spawn(
    electronBinary,
    [path.join(repoRoot, "electron", "main.mjs"), "--app-url", running.url],
    { stdio: "inherit" },
  );
  electron.on("exit", (code) => void shutdown(code ?? 0));
}
