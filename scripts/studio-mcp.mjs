/* The studio for Claude Code, from source.
 *
 * Claude Code starts this script and talks to it over stdin and stdout: an
 * MCP server (server/mcp-stdio.mjs) that starts its own studio — npm run
 * dev (scripts/dev.mjs) with the embedded Claude terminals off and git
 * commits off by default, since Claude is already driving. There is no
 * studio to find and no port to configure. Two ways it starts:
 *   in this repo    the repo's .mcp.json runs it
 *   in a library    the showcase-studio plugin runs it in place of the
 *                   packaged app when SHOWCASE_STUDIO_SRC names this repo
 * The library defaults to the folder Claude Code runs in when it holds
 * showcases or is one, as the packaged app's --mcp does; otherwise this
 * repo's showcases/.
 *
 * The studio runs as a child process (server/child-studio.mjs), so each
 * studio_start runs the source as it is then — this checkout's, or the
 * one studio_start's `source` names, such as a git worktree. This process
 * loads no studio code of its own beyond the MCP server.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { devStudioArgs, startChildStudio } from "../server/child-studio.mjs";
import { findLibrary } from "../server/launch-options.mjs";
import { serveStudioMcp, takeOverStdout } from "../server/mcp-stdio.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const version = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")).version;

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
  sources: true,
  defaultLibrary: (source) =>
    source
      ? path.join(source, "showcases")
      : (findLibrary(launchCwd) ?? path.join(repoRoot, "showcases")),
  libraryHelp:
    "the folder Claude Code runs in, when it holds showcases or is one; otherwise the " +
    "studio repo's showcases/ — or, with `source`, that checkout's showcases/",
  startStudio: ({ showcasesDir, lock, alongside, source = repoRoot }) =>
    startChildStudio({
      script: path.join(source, "scripts", "dev.mjs"),
      args: devStudioArgs({ showcasesDir, lock, alongside }),
      cwd: source,
      log,
    }),
  onExit: () => process.exit(0),
});
