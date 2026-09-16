/* The studio for Claude Code, from source.
 *
 * Claude Code starts this script and talks to it over stdin and stdout: an
 * MCP server (server/mcp-stdio.mjs) that starts its own studio — the same
 * studio `npm run dev` runs (scripts/dev-studio.mjs), with the embedded
 * Claude terminals off, since Claude is already driving. There is no
 * studio to find and no port to configure. Two ways it starts:
 *   in this repo    the repo's .mcp.json runs it
 *   in a library    the showcase-studio plugin runs it in place of the
 *                   packaged app when SHOWCASE_STUDIO_SRC names this repo
 * The library defaults to the folder Claude Code runs in when it holds
 * showcases or is one, as the packaged app's --mcp does; otherwise this
 * repo's showcases/.
 */
import path from "node:path";
import { findLibrary } from "../server/launch-options.mjs";
import { serveStudioMcp, takeOverStdout } from "../server/mcp-stdio.mjs";
import { repoRoot, startDevStudio, version } from "./dev-studio.mjs";

const send = takeOverStdout();
const log = (message) => console.error(message);
const launchCwd = process.cwd();

/* A long-lived server: a stray error in the studio is logged, not fatal. */
process.on("uncaughtException", (error) => log(`studio-mcp: ${error.stack ?? error}`));
process.on("unhandledRejection", (error) => log(`studio-mcp: ${error?.stack ?? error}`));

serveStudioMcp({
  version,
  send,
  log,
  cwd: launchCwd,
  defaultLibrary: () => findLibrary(launchCwd) ?? path.join(repoRoot, "showcases"),
  libraryHelp:
    "the folder Claude Code runs in, when it holds showcases or is one; otherwise the studio repo's showcases/",
  startStudio: ({ showcasesDir, lock }) =>
    startDevStudio({ showcasesDir, lock, features: { terminal: false }, log }),
  onExit: () => process.exit(0),
});
