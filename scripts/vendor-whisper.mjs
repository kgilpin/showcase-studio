/* Builds the studio's own whisper.cpp binary into electron/vendor/whisper/
 * (gitignored). The studio prefers this vendored copy and falls back to a
 * PATH-installed whisper-cli, so running this is only needed on machines
 * without one. Requires cmake and a C/C++ toolchain.
 *
 *   npm run vendor:whisper
 *
 * Downloads the latest whisper.cpp release source, builds the whisper-cli
 * target statically, and copies the binary into place. The speech model is
 * separate — the studio downloads it on first transcription. */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vendorDir = path.join(root, "electron", "vendor", "whisper");

const release = await (
  await fetch("https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest")
).json();
const tag = release.tag_name;
if (!tag) throw new Error("Could not resolve the latest whisper.cpp release tag");
console.log(`whisper.cpp ${tag}`);

const work = path.join(os.tmpdir(), `whisper-vendor-${tag}`);
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

const tarball = path.join(work, "src.tar.gz");
execFileSync("curl", [
  "-sL",
  "-o",
  tarball,
  `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${tag}.tar.gz`,
]);
execFileSync("tar", ["xzf", tarball, "-C", work, "--strip-components", "1"]);

console.log("building whisper-cli (this takes a few minutes)…");
/* Say which architecture to build for, rather than letting cmake decide.
 * An Intel cmake (Homebrew's /usr/local copy, running under Rosetta)
 * quietly produces an x86_64 binary on an Apple Silicon Mac: it runs,
 * under Rosetta, without the acceleration this is built for — and it
 * would need Rosetta on the user's machine too. Such a cmake can't build
 * for arm64 when asked either, so check first rather than spend five
 * minutes on a build that ends in a wall of compiler errors. */
const macArch = os.arch() === "arm64" ? "arm64" : "x86_64";
const macArchArgs = os.platform() === "darwin" ? [`-DCMAKE_OSX_ARCHITECTURES=${macArch}`] : [];
if (os.platform() === "darwin") {
  const cmakePath = execFileSync("which", ["cmake"], { encoding: "utf8" }).trim();
  const cmakeKind = execFileSync("file", ["-b", cmakePath], { encoding: "utf8" }).trim();
  if (!cmakeKind.includes(macArch)) {
    throw new Error(
      `This Mac is ${macArch}, but ${cmakePath} is ${cmakeKind}, ` +
        `which can't build for ${macArch}.\n` +
        "Install one that can:  /opt/homebrew/bin/brew install cmake",
    );
  }
}
execFileSync(
  "cmake",
  ["-B", "build", "-DCMAKE_BUILD_TYPE=Release", "-DBUILD_SHARED_LIBS=OFF", ...macArchArgs],
  {
    cwd: work,
    stdio: "inherit",
  },
);
execFileSync("cmake", ["--build", "build", "-j", "--target", "whisper-cli"], {
  cwd: work,
  stdio: "inherit",
});

mkdirSync(vendorDir, { recursive: true });
cpSync(path.join(work, "build", "bin", "whisper-cli"), path.join(vendorDir, "whisper-cli"));
rmSync(work, { recursive: true, force: true });
console.log(`vendored: ${path.join(vendorDir, "whisper-cli")}`);
