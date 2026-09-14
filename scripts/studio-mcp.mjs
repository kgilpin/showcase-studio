/* The studio for Claude Code, from source.
 *
 * Claude Code starts this script from the repo's .mcp.json and talks to it
 * over stdin and stdout: an MCP server (server/mcp-stdio.mjs) that starts
 * its own studio — the same studio `npm run dev` runs
 * (scripts/dev-studio.mjs), with the embedded Claude terminals off, since
 * Claude is already driving. There is no studio to find and no port to
 * configure. The packaged app offers the same server with --mcp, which is
 * what the showcase-studio plugin runs outside this repo.
 */
import path from "node:path";
import { serveStudioMcp, takeOverStdout } from "../server/mcp-stdio.mjs";
import { repoRoot, startDevStudio, version } from "./dev-studio.mjs";

const send = takeOverStdout();
const log = (message) => console.error(message);

/* A long-lived server: a stray error in the studio is logged, not fatal. */
process.on("uncaughtException", (error) => log(`studio-mcp: ${error.stack ?? error}`));
process.on("unhandledRejection", (error) => log(`studio-mcp: ${error?.stack ?? error}`));

serveStudioMcp({
  version,
  send,
  log,
  cwd: repoRoot,
  defaultLibrary: () => path.join(repoRoot, "showcases"),
  libraryHelp: "this repo's showcases/",
  startStudio: ({ showcasesDir, lock }) =>
    startDevStudio({ showcasesDir, lock, features: { terminal: false }, log }),
  onExit: () => process.exit(0),
});
