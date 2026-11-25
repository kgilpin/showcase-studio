/* Stages the desktop app for electron-builder into dist-electron/app/:
 *
 *   electron/ + server/   the shell and studio backend (tests excluded)
 *   .output/              the built app server (npm run build:desktop)
 *   package.json          runtime deps only (node-pty, ffmpeg-static,
 *                         esbuild, yaml), installed here with npm
 *
 * electron-builder then packages this folder (electron-builder.yml).
 * Run the whole chain with:  npm run package:desktop
 */
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { vendoredWhisper } from "../server/whisper-binary.mjs";
import {
  RUNTIME_DEPS,
  checkBuiltApp,
  copyBuiltApp,
  copySourceDir,
  repoRoot,
  versionOf,
} from "./package-files.mjs";

const stage = path.join(repoRoot, "dist-electron", "app");

checkBuiltApp();

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "showcase-studio",
      version: rootPkg.version,
      description: "Showcase Studio — video-style product tours as a desktop studio",
      private: true,
      license: rootPkg.license,
      type: "module",
      main: "electron/main.mjs",
      dependencies: Object.fromEntries(RUNTIME_DEPS.map((dep) => [dep, versionOf(dep)])),
    },
    null,
    2,
  ) + "\n",
);

/* Voice-to-text ships with the app: without it a new user's first
 * recording gets caption timings estimated from how long each line takes
 * to read, which drift from the voice and look right until you listen.
 * Better to stop the build than to ship that quietly. */
const whisper = vendoredWhisper(repoRoot);
if (!existsSync(whisper)) {
  throw new Error(`No whisper for ${process.platform} at ${whisper}.\nRun: npm run vendor:whisper`);
}

/* The shell and the studio backend, minus dev-only and test files. The
 * Playwright renderer is for the dev modes and the Linux build. The
 * shell's own dependency manifest and install (desktop-deps.mjs) stay
 * out: the staged app has its own package.json, and Electron itself is
 * the runtime, not a file inside it. */
copySourceDir(stage, "electron");
copySourceDir(stage, "server", ["renderer-playwright.mjs", "headless-main.mjs"]);
/* The src modules the studio shares with the page (package-files.mjs),
 * the built app server, and the license. */
copyBuiltApp(stage);

/* On Windows npm is npm.cmd, which Node only starts through a shell. */
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stage,
  stdio: "inherit",
  shell: process.platform === "win32",
});
/* npm strips the exec bit node-pty's spawn-helper needs (same fix as the
 * repo's postinstall). */
const prebuilds = path.join(stage, "node_modules", "node-pty", "prebuilds");
if (existsSync(prebuilds)) {
  for (const platform of readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, platform, "spawn-helper");
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
}

console.log(`staged ${stage}`);
