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
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const stage = path.join(repoRoot, "dist-electron", "app");

const nitroJson = path.join(repoRoot, ".output", "nitro.json");
const preset = existsSync(nitroJson) ? JSON.parse(readFileSync(nitroJson, "utf8")).preset : null;
if (preset !== "node-server") {
  console.error(
    `.output/ is ${preset ? `a ${preset} build` : "missing"} — run \`npm run build:desktop\` first`,
  );
  process.exit(1);
}

rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const RUNTIME_DEPS = ["node-pty", "ffmpeg-static", "esbuild", "yaml"];
const rootPkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const versionOf = (dep) => {
  const version = rootPkg.dependencies?.[dep] ?? rootPkg.devDependencies?.[dep];
  if (!version) throw new Error(`${dep} not found in package.json`);
  return version;
};
writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "showcase-studio",
      version: rootPkg.version,
      description: "Showcase Studio — video-style product tours as a desktop studio",
      private: true,
      type: "module",
      main: "electron/main.mjs",
      dependencies: Object.fromEntries(RUNTIME_DEPS.map((dep) => [dep, versionOf(dep)])),
    },
    null,
    2,
  ) + "\n",
);

/* The shell and the studio backend, minus dev-only and test files. */
for (const dir of ["electron", "server"]) {
  mkdirSync(path.join(stage, dir));
  for (const file of readdirSync(path.join(repoRoot, dir))) {
    if (file === "dev.mjs" || file.endsWith(".test.mjs")) continue;
    cpSync(path.join(repoRoot, dir, file), path.join(stage, dir, file), { recursive: true });
  }
}
/* The timing model — imported by prompter-script.mjs and exporter.mjs
 * at their staged-relative ../src/content path. */
mkdirSync(path.join(stage, "src", "content"), { recursive: true });
cpSync(
  path.join(repoRoot, "src", "content", "timing.mjs"),
  path.join(stage, "src", "content", "timing.mjs"),
);
cpSync(path.join(repoRoot, ".output"), path.join(stage, ".output"), { recursive: true });

execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stage,
  stdio: "inherit",
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
