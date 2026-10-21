#!/usr/bin/env node
/**
 * Makes the site's media from the repo's own files, small enough for the web:
 *
 *   the showcase-studio video export    →  public/media/hero.mp4  (720×1280, H.264)
 *                                       →  public/media/hero.jpg  (4 s in, the poster)
 *   the nova video export               →  public/media/nova-gate.jpg, nova-capture.jpg
 *                                          (two frames of its jump gate scene, the examples
 *                                          in the first two sections)
 *                                       →  public/media/showcase-command.jpg (8.4 s in: the
 *                                          /showcase graphic, the "custom graphics" example)
 *   media-src/nova-prompter.png         →  public/media/prompter.webp (from npm run capture:prompter)
 *   three of nova's screenshots         →  public/media/nova-starmap.webp, nova-fleet.webp,
 *                                          nova-gate-shot.webp (the "add screenshots" timeline)
 *
 * Make the export first, from the repo root, with either of:
 *   npm run dev -- --export video:showcase-studio   (needs no studio running;
 *                                  writes ~/Downloads/showcase-exports/showcase-studio/)
 *   npm run export:video -- showcase-studio         (needs a studio; writes exports/)
 * and the same for nova (video-draft:nova is enough for the frames).
 * HERO_VIDEO=<file> and NOVA_VIDEO=<file> pick any other MP4.
 *
 * Uses the ffmpeg the studio already installs (ffmpeg-static in the repo's
 * node_modules), FFMPEG=<path>, or the one on PATH — which needs libwebp.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repo = path.resolve(site, "..");
const out = path.join(site, "public", "media");
mkdirSync(out, { recursive: true });

const bundled = path.join(repo, "node_modules", "ffmpeg-static", "ffmpeg");
const ffmpeg = process.env.FFMPEG ?? (existsSync(bundled) ? bundled : "ffmpeg");
const run = (args) =>
  execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

const candidates = process.env.HERO_VIDEO
  ? [process.env.HERO_VIDEO]
  : [
      path.join(
        os.homedir(),
        "Downloads",
        "showcase-exports",
        "showcase-studio",
        "showcase-studio.mp4",
      ),
      path.join(repo, "exports", "showcase-studio", "video.mp4"),
    ];
const video = candidates.find((file) => existsSync(file));
if (!video) {
  console.error(
    `No hero video. Looked for:\n  ${candidates.join("\n  ")}\nExport it first: npm run dev -- --export video:showcase-studio (from the repo root).`,
  );
  process.exit(1);
}

run([
  "-i",
  video,
  "-vf",
  "scale=720:1280",
  "-c:v",
  "libx264",
  "-preset",
  "slow",
  "-crf",
  "26",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  "-b:a",
  "96k",
  "-movflags",
  "+faststart",
  path.join(out, "hero.mp4"),
]);
// The poster is 4 s in, where the first caption is fully lit in the current
// showcase-studio showcase; check it after the showcase changes.
run([
  "-ss",
  "4",
  "-i",
  video,
  "-frames:v",
  "1",
  "-vf",
  "scale=720:1280",
  "-q:v",
  "4",
  path.join(out, "hero.jpg"),
]);

// The /showcase graphic (graphics/showcase-command.tsx) at 8.4 s, once
// the studio has opened beside the chat; check it after the showcase changes.
run([
  "-ss",
  "8.4",
  "-i",
  video,
  "-frames:v",
  "1",
  "-vf",
  "scale=540:960",
  "-q:v",
  "4",
  path.join(out, "showcase-command.jpg"),
]);

// The frame times are where each caption is fully lit in the current nova
// showcase; check the frames after the showcase changes.
const exportsDir = path.join(os.homedir(), "Downloads", "showcase-exports", "nova");
const nova =
  process.env.NOVA_VIDEO ??
  ["nova.mp4", "nova_draft.mp4"].map((f) => path.join(exportsDir, f)).find((f) => existsSync(f));
if (!nova) {
  console.error(
    `No nova video in ${exportsDir}.\nExport it first: npm run dev -- --export video-draft:nova (from the repo root).`,
  );
  process.exit(1);
}
for (const [seconds, name] of [
  ["30.85", "nova-gate.jpg"],
  ["35.4", "nova-capture.jpg"],
]) {
  run([
    "-ss",
    seconds,
    "-i",
    nova,
    "-frames:v",
    "1",
    "-vf",
    "scale=540:960",
    "-q:v",
    "4",
    path.join(out, name),
  ]);
}

// The teleprompter picture, captured from a running studio by
// npm run capture:prompter.
run([
  "-i",
  path.join(site, "media-src", "nova-prompter.png"),
  "-vf",
  "scale=520:-2",
  "-c:v",
  "libwebp",
  "-quality",
  "82",
  path.join(out, "prompter.webp"),
]);

// The timeline's thumbnails, straight from nova's assets.
for (const [asset, name] of [
  ["shot-starmap", "nova-starmap.webp"],
  ["shot-send-fleet", "nova-fleet.webp"],
  ["shot-jump-gate", "nova-gate-shot.webp"],
]) {
  run([
    "-i",
    path.join(repo, "showcases", "nova", "assets", `${asset}.png`),
    "-vf",
    "scale=-2:540",
    "-c:v",
    "libwebp",
    "-quality",
    "80",
    path.join(out, name),
  ]);
}

console.log(`hero video from ${video}\nnova frames from ${nova}`);
for (const name of [
  "hero.mp4",
  "hero.jpg",
  "showcase-command.jpg",
  "nova-gate.jpg",
  "nova-capture.jpg",
  "prompter.webp",
  "nova-starmap.webp",
  "nova-fleet.webp",
  "nova-gate-shot.webp",
]) {
  const kb = Math.round(statSync(path.join(out, name)).size / 1024);
  console.log(`${name.padEnd(22)} ${kb} KB`);
}
