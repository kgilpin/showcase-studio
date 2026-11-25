/* Builds the Linux x64 studio: plain Node, no Electron, no window.
 *
 *   npm run package:linux     (vendor:whisper, build:desktop, then this)
 *
 * It runs on Linux x64 only, because ffmpeg-static, esbuild and node-pty
 * install programs for the machine that runs npm install. The release
 * builds it in CI (.github/workflows/desktop-build.yml).
 *
 * Output, in dist-linux/:
 *
 *   Showcase-Studio-<version>-linux-x64.tar.gz
 *   SHA256SUMS-linux-x64        one line, for the tarball
 *
 * The tarball holds one folder:
 *
 *   showcase-studio/
 *     bin/showcase-studio       the launcher: takes the same options as the app
 *                               (--mcp, --export <kind>:<id>, --library, --help)
 *     bin/install-chrome        installs Google Chrome for exports (root or sudo)
 *     node/bin/node             Node 22, the one that ran this build
 *     server/                   the studio; server/headless-main.mjs is the entry
 *     src/  .output/            the shared modules and the built app server
 *     electron/vendor/whisper/  whisper-cli, at the path the studio looks for it
 *     node_modules/             runtime packages, Playwright among them
 *     VERSION  LICENSE  package.json
 *
 * Node comes inside so a CI job needs nothing but the tarball. The
 * browser doesn't: GitHub's Ubuntu runners already have Google Chrome,
 * and elsewhere bin/install-chrome puts it in once. Playwright's own
 * Chromium works too, but can't play MP4, so video clips would render
 * blank. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
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

function fail(message) {
  console.error(`package-linux: ${message}`);
  process.exit(1);
}

if (process.platform !== "linux" || process.arch !== "x64") {
  fail(`builds on Linux x64 only (this is ${process.platform} ${process.arch}).`);
}
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor !== 22) {
  fail(`ships the Node that runs it, which must be Node 22 (this is ${process.version}).`);
}
checkBuiltApp();

/* Voice-to-text ships with the build, as with the desktop app
 * (package-desktop.mjs says why). */
const whisper = vendoredWhisper(repoRoot);
if (!existsSync(whisper)) fail(`no whisper at ${whisper}. Run: npm run vendor:whisper`);

const out = path.join(repoRoot, "dist-linux");
const stage = path.join(out, "showcase-studio");
const { version, license } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
const tarball = `Showcase-Studio-${version}-linux-x64.tar.gz`;
const sums = "SHA256SUMS-linux-x64";

rmSync(out, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });

const deps = [...RUNTIME_DEPS, "playwright"];
writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "showcase-studio",
      version,
      description: "Showcase Studio — video-style product tours, with no window, for Linux",
      private: true,
      license,
      type: "module",
      main: "server/headless-main.mjs",
      dependencies: Object.fromEntries(deps.map((dep) => [dep, versionOf(dep)])),
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(path.join(stage, "VERSION"), `${version}\n`);

/* The whole studio, the Playwright renderer and this build's entry included. */
copySourceDir(stage, "server");
copyBuiltApp(stage);
mkdirSync(path.dirname(vendoredWhisper(stage)), { recursive: true });
cpSync(whisper, vendoredWhisper(stage));
chmodSync(vendoredWhisper(stage), 0o755);

/* npm install with this Node first on PATH, so node-pty is compiled for
 * the Node that ships. */
const nodeDir = path.dirname(process.execPath);
execFileSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stage,
  stdio: "inherit",
  env: { ...process.env, PATH: `${nodeDir}${path.delimiter}${process.env.PATH}` },
});

/* Node itself, with its license (an official Node build has it one
 * folder up from bin/). */
mkdirSync(path.join(stage, "node", "bin"), { recursive: true });
cpSync(process.execPath, path.join(stage, "node", "bin", "node"));
chmodSync(path.join(stage, "node", "bin", "node"), 0o755);
const nodeLicense = path.join(nodeDir, "..", "LICENSE");
if (!existsSync(nodeLicense))
  fail(`no Node license at ${nodeLicense}: use an official Node build.`);
cpSync(nodeLicense, path.join(stage, "node", "LICENSE"));

/* The launchers. Plain sh; each finds the build through its own real
 * path, so a symlink to it (in /usr/local/bin, say) works. */
const launcher = (comment, command) => `#!/bin/sh
# ${comment}
here="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
exec "$here/node/bin/node" ${command} "$@"
`;
mkdirSync(path.join(stage, "bin"));
writeFileSync(
  path.join(stage, "bin", "showcase-studio"),
  launcher(
    "Showcase Studio with no window. --help lists the options.",
    '"$here/server/headless-main.mjs"',
  ),
);
writeFileSync(
  path.join(stage, "bin", "install-chrome"),
  launcher(
    "Installs Google Chrome, which exports draw pages with (Playwright's installer, as root or with sudo).",
    '"$here/node_modules/playwright/cli.js" install chrome',
  ),
);
for (const name of ["showcase-studio", "install-chrome"]) {
  chmodSync(path.join(stage, "bin", name), 0o755);
}

console.log(`packing ${tarball}…`);
execFileSync("tar", ["-czf", path.join(out, tarball), "-C", out, "showcase-studio"], {
  stdio: "inherit",
});
const hash = createHash("sha256");
for await (const chunk of createReadStream(path.join(out, tarball))) hash.update(chunk);
writeFileSync(path.join(out, sums), `${hash.digest("hex")}  ${tarball}\n`);

console.log(`built ${path.join(out, tarball)}\n${readFileSync(path.join(out, sums), "utf8")}`);
