#!/usr/bin/env node
/**
 * Makes the site's media from the repo's own files, small enough for the web:
 *
 *   the showcase-studio video export    →  public/media/hero.mp4  (720×1280, H.264)
 *                                       →  public/media/hero.jpg  (its first second, the poster)
 *                                       →  public/media/frame.jpg (a finished frame, 50.1 s in)
 *   showcases/showcase-studio/assets/   →  public/media/*.webp    (the feature pictures)
 *
 * Make the export first, from the repo root, with either of:
 *   npm run dev -- --export video:showcase-studio   (needs no studio running;
 *                                  writes ~/Downloads/showcase-exports/showcase-studio/)
 *   npm run export:video -- showcase-studio         (needs a studio; writes exports/)
 * HERO_VIDEO=<file> picks any other MP4.
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
const run = (args) => execFileSync(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });

const candidates = process.env.HERO_VIDEO
  ? [process.env.HERO_VIDEO]
  : [
      path.join(os.homedir(), "Downloads", "showcase-exports", "showcase-studio", "showcase-studio.mp4"),
      path.join(repo, "exports", "showcase-studio", "video.mp4"),
    ];
const video = candidates.find((file) => existsSync(file));
if (!video) {
  console.error(`No hero video. Looked for:\n  ${candidates.join("\n  ")}\nExport it first: npm run dev -- --export video:showcase-studio (from the repo root).`);
  process.exit(1);
}

run(["-i", video, "-vf", "scale=720:1280", "-c:v", "libx264", "-preset", "slow", "-crf", "26",
  "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
  path.join(out, "hero.mp4")]);
run(["-ss", "1", "-i", video, "-frames:v", "1", "-vf", "scale=720:1280", "-q:v", "4", path.join(out, "hero.jpg")]);
run(["-ss", "50.1", "-i", video, "-frames:v", "1", "-vf", "scale=540:960", "-q:v", "4", path.join(out, "frame.jpg")]);

const assets = path.join(repo, "showcases", "showcase-studio", "assets");
const pictures = [
  ["shot-claude-desktop.png", "claude-desktop.webp", 1200],
  ["shot-prompter.png", "prompter.webp", 440],
];
for (const [from, to, width] of pictures) {
  run(["-i", path.join(assets, from), "-vf", `scale=${width}:-2`, "-c:v", "libwebp", "-quality", "82", path.join(out, to)]);
}

console.log(`hero video from ${video}`);
for (const name of ["hero.mp4", "hero.jpg", "frame.jpg", ...pictures.map((p) => p[1])]) {
  const kb = Math.round(statSync(path.join(out, name)).size / 1024);
  console.log(`${name.padEnd(22)} ${kb} KB`);
}
