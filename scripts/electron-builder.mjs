/* Runs electron-builder from electron/node_modules (npm run setup:desktop),
 * from the repo root, telling it the Electron version installed there —
 * it would otherwise look for electron in the root package.json, which no
 * longer lists it. Every argument passes through:
 *   node scripts/electron-builder.mjs --dir
 *   node scripts/electron-builder.mjs --mac */
import { spawnSync } from "node:child_process";
import { electronBuilderCli, electronVersion, repoRoot } from "./desktop-deps.mjs";

let cli;
let version;
try {
  cli = electronBuilderCli();
  version = electronVersion();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
const result = spawnSync(
  process.execPath,
  [cli, `--config.electronVersion=${version}`, ...process.argv.slice(2)],
  { cwd: repoRoot, stdio: "inherit" },
);
process.exit(result.status ?? 1);
