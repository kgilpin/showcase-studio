/* Puts whisper.cpp's whisper-cli into electron/vendor/whisper/
 * (gitignored), which is what the packaged app ships and what the studio
 * runs for voice-to-text. The speech model is separate — the studio
 * downloads it on first transcription.
 *
 *   npm run vendor:whisper          # once; a later run leaves it alone
 *   npm run vendor:whisper -- --force
 *
 * macOS: built from source, because whisper.cpp publishes no whisper-cli
 * for macOS — only an xcframework. Needs cmake and a C/C++ toolchain.
 * The cmake must be one for this Mac's architecture: an Intel cmake
 * under Rosetta can only make an x86_64 binary, so it is refused.
 *
 * Windows: downloaded, because there is a build to download. It comes
 * from one pinned release, checked against its SHA-256, and only the
 * files whisper-cli needs are kept (the archive also holds llama, SDL2,
 * parakeet and the test programs).
 *
 * Packaging fails when this hasn't been run, rather than shipping an app
 * that can't transcribe. npm run package:desktop and release:desktop run
 * it first. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { vendoredWhisper, whisperBinaryName } from "../server/whisper-binary.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vendorDir = path.join(root, "electron", "vendor", "whisper");
const binary = vendoredWhisper(root);
const force = process.argv.includes("--force");

if (existsSync(binary) && !force) {
  console.log(`already vendored: ${binary}\nRun with --force to replace it.`);
  process.exit(0);
}

/* One pinned Windows build. whisper.cpp puts its binaries on the rolling
 * b#### tags, not the version tags, which often carry no files at all. */
const WINDOWS = {
  tag: "b5130",
  file: "whisper-bin-x64.zip",
  sha256: "f9ec6c52a2e949b62ab51fa21d0d497958f9e41c3010c157c4e42932d5316f3c",
  /* whisper-cli.exe plus what it loads: whisper.dll, ggml.dll,
   * ggml-base.dll, and the ggml-cpu-*.dll variants ggml picks from at
   * run time for the processor it finds. Nothing else in the archive. */
  keep: (name) => /^(whisper-cli\.exe|whisper\.dll|ggml(-base|-cpu-[a-z0-9]+)?\.dll)$/.test(name),
};

if (process.platform === "win32") {
  await vendorWindows();
  process.exit(0);
}
if (process.platform !== "darwin") {
  throw new Error(
    `The studio is packaged for macOS and Windows; there is no vendored whisper for ${process.platform}.\n` +
      "Install whisper-cli yourself and point $SHOWCASE_STUDIO_WHISPER at it.",
  );
}

async function vendorWindows() {
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${WINDOWS.tag}/${WINDOWS.file}`;
  console.log(`downloading ${WINDOWS.tag} ${WINDOWS.file}…`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  const zip = Buffer.from(await response.arrayBuffer());
  const got = createHash("sha256").update(zip).digest("hex");
  if (got !== WINDOWS.sha256) {
    throw new Error(
      `${WINDOWS.file} is not the pinned build: expected ${WINDOWS.sha256}, got ${got}`,
    );
  }
  const work = path.join(os.tmpdir(), `whisper-win-${WINDOWS.tag}`);
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const archive = path.join(work, WINDOWS.file);
  writeFileSync(archive, zip);
  /* Windows 10 and later ship bsdtar, which reads zips. */
  execFileSync("tar", ["-xf", archive, "-C", work], { stdio: "inherit" });
  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });
  let kept = 0;
  for (const dir of [work, path.join(work, "Release")]) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!WINDOWS.keep(name)) continue;
      cpSync(path.join(dir, name), path.join(vendorDir, name));
      kept += 1;
    }
  }
  rmSync(work, { recursive: true, force: true });
  if (!existsSync(binary)) throw new Error(`${WINDOWS.file} held no whisper-cli.exe`);
  console.log(`vendored: ${binary} (${kept} files)`);
}

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
