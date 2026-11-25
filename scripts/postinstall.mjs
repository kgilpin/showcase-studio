/* Runs after `npm install`. Two jobs:
 *
 * 1. npm strips the exec bit from node-pty's spawn-helper, which macOS and
 *    Linux need to start a terminal. Windows has no spawn-helper and no
 *    exec bit, so there is nothing to do there.
 * 2. Point git at the repo's own hooks in .githooks/ (the pre-commit
 *    secret scan), unless this clone already uses a hooks folder of its own.
 *
 * A Node script rather than a shell one-liner: npm runs install scripts
 * with cmd.exe on Windows, which knows neither chmod nor 2>/dev/null. */
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";

if (process.platform !== "win32") {
  const prebuilds = path.join("node_modules", "node-pty", "prebuilds");
  for (const platform of existsSync(prebuilds) ? readdirSync(prebuilds) : []) {
    const helper = path.join(prebuilds, platform, "spawn-helper");
    try {
      if (existsSync(helper)) chmodSync(helper, 0o755);
    } catch {
      /* Not ours to fail an install over; a terminal just won't start. */
    }
  }
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
try {
  // Only in a git checkout of this repo, not a copy without .git.
  if (
    existsSync(".githooks") &&
    path.resolve(git("rev-parse", "--show-toplevel")) === process.cwd()
  ) {
    let current = "";
    try {
      current = git("config", "--get", "core.hooksPath");
    } catch {
      /* Not set. */
    }
    if (!current) git("config", "core.hooksPath", ".githooks");
    else if (current !== ".githooks")
      console.log(`git hooks: core.hooksPath is ${current}, so .githooks/pre-commit won't run.`);
  }
} catch {
  /* No git, or not a checkout: nothing to set up. */
}
