/* Builds the app server for the desktop app: `vite build` with the library
 * data served by the studio at /showcase-data (VITE_SHOWCASES_URL, which
 * vite.config.ts bakes into the page).
 *
 * A script rather than `VITE_SHOWCASES_URL=… vite build` in package.json:
 * that way of setting a variable is shell syntax, and npm runs scripts with
 * cmd.exe on Windows. */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vite = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vite/package.json")),
  "bin",
  "vite.js",
);

execFileSync(process.execPath, [vite, "build"], {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, VITE_SHOWCASES_URL: "/showcase-data" },
});
