/* The Linux build's entry: the built studio in plain Node, with no window.
 * Its launcher, bin/showcase-studio (scripts/package-linux.mjs writes
 * it), runs this file with the Node 22 the build carries.
 *
 * It starts the same studio as the Mac and Windows app
 * (server/app-studio.mjs), and draws pages for screenshots and exports
 * with Playwright (server/renderer-playwright.mjs): Google Chrome when
 * installed, else Playwright's Chromium. Electron's renderer would need a
 * display, and a CI machine has none.
 *
 *   --mcp                Claude Code's studio (the showcase-studio plugin
 *                        runs it): an MCP server on stdin and stdout
 *                        (server/mcp-stdio.mjs). The studio starts when a
 *                        tool asks for one; there is never a window.
 *   --export <kind>:<id> export one showcase, print `exported: <file>`, quit.
 *   anything else        the studio runs until stopped (Ctrl+C), printing
 *                        `studio: <url>` to open in a browser. --no-window
 *                        is accepted and changes nothing.
 *
 * `--help` lists the options (server/launch-options.mjs). */
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { appRoot, startAppStudio } from "./app-studio.mjs";
import {
  LIBRARY_FOR_CLAUDE_HELP,
  STUDIO_USAGE,
  libraryForClaude,
  studioOptions,
} from "./launch-options.mjs";
import { serveStudioMcp, takeOverStdout } from "./mcp-stdio.mjs";
import { createPlaywrightRenderer } from "./renderer-playwright.mjs";
import { loadSettings } from "./settings.mjs";
import { alreadyOpen, runningStudio } from "./studio-presence.mjs";

const version = JSON.parse(readFileSync(path.join(appRoot, "package.json"), "utf8")).version;
const launchCwd = process.cwd();
const INSTALL_HINT =
  `Install Google Chrome (it plays the MP4 clips in slides): ` +
  `${path.join(appRoot, "bin", "install-chrome")}, as root or with sudo.`;

/* With --mcp, stdout is the MCP channel: take it over before anything logs. */
const mcpRequested = process.argv.includes("--mcp");
const send = mcpRequested ? takeOverStdout() : null;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const defaultDir = loadSettings().showcasesDir ?? path.join(os.homedir(), "Showcases");
let options;
try {
  options = studioOptions(process.argv, { cwd: launchCwd, defaultDir });
} catch (error) {
  fail(`${error.message}\n\n${STUDIO_USAGE}`);
}
if (options.help) {
  process.stdout.write(STUDIO_USAGE);
  process.exit(0);
}
if (options.electron || options.appUrl) {
  fail("The Linux build has no desktop window: leave out --electron and --app-url.");
}

/* A launcher can pick the studio's port with PORT. Read it now: the built
 * app server takes PORT over for its own address. */
const launcherPort = Number(process.env.PORT) || undefined;

const startStudio = ({ showcasesDir, lock, features, port, log }) =>
  startAppStudio({
    showcasesDir,
    lock,
    features,
    port,
    version,
    log,
    renderer: createPlaywrightRenderer({ log, installHint: INSTALL_HINT }),
  });

if (options.mcp) {
  /* A long-lived server: a stray error in the studio is logged, not fatal. */
  process.on("uncaughtException", (error) => console.error(`studio: ${error.stack ?? error}`));
  process.on("unhandledRejection", (error) => console.error(`studio: ${error?.stack ?? error}`));
  const log = (message) => console.error(message);
  serveStudioMcp({
    version,
    send,
    log,
    cwd: launchCwd,
    /* --library on the command line wins; otherwise the folder Claude
     * Code runs in, never the saved folder or ~/Showcases. */
    defaultLibrary: () =>
      process.argv.some((arg) => arg === "--library" || arg.startsWith("--library="))
        ? { library: options.showcasesDir, reason: "the folder the app was given with --library" }
        : libraryForClaude(launchCwd),
    libraryHelp: LIBRARY_FOR_CLAUDE_HELP,
    startStudio: ({ showcasesDir, lock }) =>
      startStudio({ showcasesDir, lock, features: { terminal: false, autoCommit: false }, log }),
    onExit: () => process.exit(0),
  });
} else {
  await runStudio();
}

async function runStudio() {
  /* One studio per library (server/studio-presence.mjs); an export is a
   * short headless render, meant to run beside an open studio. */
  if (!options.exportJob) {
    const other = await runningStudio(options.showcasesDir);
    if (other) fail(alreadyOpen(options.showcasesDir, other.url));
  }
  let running;
  try {
    running = await startStudio({
      showcasesDir: options.showcasesDir,
      lock: options.lock,
      features: { terminal: options.terminal, autoCommit: options.autoCommit },
      port: launcherPort,
    });
  } catch (error) {
    fail(`The studio failed to start: ${error.message}`);
  }
  console.log(`studio: ${running.url}`);

  if (options.exportJob) {
    const { kind, showcaseId } = options.exportJob;
    try {
      const out = await running.studio.exportNow(kind, showcaseId, {
        onProgress: (label) => console.log(`${kind} ${showcaseId}: ${label}`),
      });
      console.log(`exported: ${out}`);
      await running.close();
      process.exit(0);
    } catch (error) {
      fail(`${kind} ${showcaseId} failed: ${error.message}`);
    }
  }

  if (options.window) console.log(`The Linux build has no window. Open ${running.landingUrl()}`);
  const stop = async () => {
    await running.close().catch(() => {});
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
