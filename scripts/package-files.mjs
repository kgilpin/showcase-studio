/* What every packaged build carries besides server/ and .output/, shared
 * by scripts/package-desktop.mjs (Mac and Windows) and
 * scripts/package-linux.mjs (Linux). */
import { cpSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/* The studio's runtime packages, at the versions in the root package.json. */
export const RUNTIME_DEPS = [
  "node-pty",
  "ffmpeg-static",
  "esbuild",
  "yaml",
  "@xterm/headless",
  "@xterm/addon-serialize",
];

/* Plain modules the page shares with the shell and the studio server, at
 * their staged-relative ../src paths: the timing model (prompter-script.mjs,
 * exporter.mjs), what counts as media (asset-files.mjs), the brand mark's
 * rules, where captions may sit and what a TikTok fit may say
 * (edit-yaml.mjs), what a theme may hold (edit-theme.mjs), the text a
 * post uses and where it can go (edit-yaml.mjs, share.mjs), the lock rule
 * (server/app-studio.mjs, electron/main.mjs), the last page error
 * (server/mcp.mjs, exporter.mjs), and export names (the export
 * notification in electron/main.mjs). scripts/package-desktop.test.mjs
 * fails when server/ or electron/ imports a src file missing here. */
export const SHARED_SRC = [
  "content/asset-kinds.mjs",
  "content/caption-position-rules.mjs",
  "content/caption-starts-rules.mjs",
  "content/cover-rules.mjs",
  "content/publish-rules.mjs",
  "content/showcase-schema.mjs",
  "content/theme-rules.mjs",
  "content/tiktok-fit-rules.mjs",
  "content/timing.mjs",
  "content/watermark-rules.mjs",
  "lib/window-lock.mjs",
  "lib/page-error.mjs",
  "lib/export-kinds.mjs",
];

/** The version of `dep` the root package.json asks for. */
export function versionOf(dep) {
  const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const version = rootPkg.dependencies?.[dep] ?? rootPkg.devDependencies?.[dep];
  if (!version) throw new Error(`${dep} not found in package.json`);
  return version;
}

/** Copies `dir` (server/ or electron/) into the stage, minus test files,
 *  its own package manifest and install, and the files `skip` names. */
export function copySourceDir(stage, dir, skip = []) {
  mkdirSync(path.join(stage, dir));
  for (const file of readdirSync(path.join(repoRoot, dir))) {
    if (file.endsWith(".test.mjs") || skip.includes(file)) continue;
    if (["package.json", "package-lock.json", "node_modules"].includes(file)) continue;
    cpSync(path.join(repoRoot, dir, file), path.join(stage, dir, file), { recursive: true });
  }
}

/** Copies SHARED_SRC, .output/ and LICENSE into the stage. */
export function copyBuiltApp(stage) {
  for (const shared of SHARED_SRC) {
    mkdirSync(path.join(stage, "src", path.dirname(shared)), { recursive: true });
    cpSync(path.join(repoRoot, "src", shared), path.join(stage, "src", shared));
  }
  cpSync(path.join(repoRoot, ".output"), path.join(stage, ".output"), { recursive: true });
  /* The license covers the app's builds too, so each copy carries it. */
  cpSync(path.join(repoRoot, "LICENSE"), path.join(stage, "LICENSE"));
}

/** Stops unless .output/ is the node-server build npm run build:desktop makes. */
export function checkBuiltApp() {
  const nitroJson = path.join(repoRoot, ".output", "nitro.json");
  let preset = null;
  try {
    preset = JSON.parse(readFileSync(nitroJson, "utf8")).preset;
  } catch {
    /* missing */
  }
  if (preset !== "node-server") {
    console.error(
      `.output/ is ${preset ? `a ${preset} build` : "missing"} — run \`npm run build:desktop\` first`,
    );
    process.exit(1);
  }
}
