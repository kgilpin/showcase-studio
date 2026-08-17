/* In-app exports: renders the app's own export/record pages in an
 * offscreen window and captures them — the Electron replacement for the
 * Playwright scripts.
 *
 *   exportScreens  screenshots each scene's /export/<sceneId> page at
 *                  1320×2868 (App Store 6.9") — scenes with
 *                  `export: false` are skipped.
 *   exportVideo    frame-by-frame capture of the /record page driven by
 *                  window.__record.seek(), assembled into an MP4 with
 *                  the bundled ffmpeg. Exact but slow, like the
 *                  frame-by-frame web export. The showcase's soundtrack
 *                  (meta.soundtrack.src) is looped under the video when
 *                  set — frame-by-frame timing starts the video at 0, so
 *                  a timeline-synced voiceover lands exactly.
 *
 * Offscreen windows render at the primary display's scale factor, so the
 * window is sized to target ÷ scale and captures land at exactly
 * 1320×2868; the stage's container-query typography keeps the layout
 * identical at any resolution.
 */
import { BrowserWindow, screen } from "electron";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";

const require_ = createRequire(import.meta.url);
const ffmpeg = require_("ffmpeg-static");

const WIDTH = 1320;
const HEIGHT = 2868;

function studioWindow(width = WIDTH, height = HEIGHT) {
  const scale = screen.getPrimaryDisplay().scaleFactor || 1;
  return new BrowserWindow({
    show: false,
    width: Math.round(width / scale),
    height: Math.round(height / scale),
    frame: false,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true },
  });
}

/** Cooperative cancellation: exports check the signal between captures. */
function checkAborted(signal) {
  if (signal?.aborted) throw new Error("Export canceled");
}

async function loadPage(win, url) {
  await win.loadURL(url);
  /* In data mode the page renders only after the client fetches the
   * showcase data — wait for the export page to mount, then for fonts
   * and images, then for a paint to flush. */
  await win.webContents.executeJavaScript(`(async () => {
    while (!document.querySelector(".export-static")) await new Promise((r) => setTimeout(r, 50));
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {})));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
}

/** Seeks the record page to `ms` and captures the settled frame.
 *  (capturePage scales by the display factor, matching the screenshot
 *  path — offscreen paint events don't, so they aren't used here.) */
async function seekAndCapture(win, ms) {
  await win.webContents.executeJavaScript(`(async () => {
    window.__record.seek(${ms});
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  })()`);
  return win.webContents.capturePage();
}

function readDoc(showcasesDir, showcaseId) {
  return parse(readFileSync(path.join(showcasesDir, showcaseId, "showcase.yaml"), "utf8"));
}

/** Resolves meta.soundtrack.src to something ffmpeg can read: an asset key
 *  (like scene media) becomes the file in the showcase's assets/ folder, a
 *  root-relative path is fetched from the app, and absolute URLs pass
 *  through. Returns undefined when there is no track (or the key doesn't
 *  match a file) — the export then simply has no audio. */
function soundtrackInput({ showcasesDir, showcaseId, appUrl, soundtrack }) {
  const src = soundtrack?.src;
  if (!src) return undefined;
  if (/^https?:/.test(src)) return src;
  if (src.startsWith("/")) return appUrl + src;
  const dir = path.join(showcasesDir, showcaseId, "assets");
  try {
    const file = readdirSync(dir).find((f) => f === src || f.replace(/\.[^.]+$/, "") === src);
    return file ? path.join(dir, file) : undefined;
  } catch {
    return undefined;
  }
}

export async function exportScreens({
  showcasesDir,
  showcaseId,
  appUrl,
  outDir,
  progress,
  signal,
}) {
  const doc = readDoc(showcasesDir, showcaseId);
  // footage scenes default out of the screenshot set (export: true opts in).
  const scenes = doc.scenes.filter(
    (scene) => (scene.export ?? (scene.theme !== "footage" ? true : false)) !== false,
  );
  mkdirSync(outDir, { recursive: true });
  const win = studioWindow();
  try {
    for (const [i, scene] of scenes.entries()) {
      checkAborted(signal);
      const name = `${String(i + 1).padStart(2, "0")}-${scene.id}.png`;
      await loadPage(win, `${appUrl}/showcase/${showcaseId}/export/${scene.id}`);
      const image = await win.webContents.capturePage();
      writeFileSync(path.join(outDir, name), image.toPNG());
      progress?.(`screenshot ${i + 1}/${scenes.length}: ${name}`);
    }
  } finally {
    win.destroy();
  }
  return outDir;
}

export async function exportVideo({
  showcasesDir,
  showcaseId,
  appUrl,
  outDir,
  fps = 30,
  /** Draft mode: half size, meant for low fps — a fast check render. */
  draft = false,
  progress,
  signal,
}) {
  const doc = readDoc(showcasesDir, showcaseId);
  const totalMs = doc.scenes.reduce(
    (sum, scene) => sum + resolveSceneTiming(scene, doc.meta.pace).durationMs,
    0,
  );
  const frameCount = Math.round((totalMs / 1000) * fps);
  mkdirSync(outDir, { recursive: true });
  const framesDir = await mkdtemp(path.join(os.tmpdir(), `studio-${showcaseId}-`));
  const win = draft ? studioWindow(660, 1434) : studioWindow();
  win.webContents.setFrameRate(60);
  try {
    await win.loadURL(`${appUrl}/showcase/${showcaseId}/record?controlled=1`);
    await win.webContents.executeJavaScript(`(async () => {
      while (window.__record?.ready !== true) await new Promise((r) => setTimeout(r, 100));
    })()`);
    for (let frame = 0; frame < frameCount; frame++) {
      checkAborted(signal);
      const ms = Math.min((frame / fps) * 1000, totalMs);
      const image = await seekAndCapture(win, ms);
      writeFileSync(
        path.join(framesDir, `frame-${String(frame).padStart(6, "0")}.png`),
        image.toPNG(),
      );
      if (frame % fps === 0) {
        progress?.(`frame ${frame + 1}/${frameCount} (${Math.round(ms / 1000)}s)`);
      }
    }
    checkAborted(signal);
    progress?.(`encoding ${frameCount} frames…`);
    const outPath = path.join(outDir, draft ? "video-draft.mp4" : "video.mp4");
    const audio = soundtrackInput({
      showcasesDir,
      showcaseId,
      appUrl,
      soundtrack: doc.meta.soundtrack,
    });
    await new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        path.join(framesDir, "frame-%06d.png"),
        ...(audio ? ["-stream_loop", "-1", "-i", audio] : []),
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        ...(audio
          ? ["-af", `volume=${doc.meta.soundtrack?.volume ?? 1}`, "-c:a", "aac", "-b:a", "192k"]
          : []),
        /* Explicit output duration — `-shortest` with an infinitely
         * looped audio input can keep ffmpeg reading forever. */
        "-t",
        (totalMs / 1000).toFixed(3),
        outPath,
      ];
      const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      proc.stderr.on("data", (chunk) => (stderr += chunk));
      proc.on("error", reject);
      proc.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-400)}`)),
      );
    });
    return outPath;
  } finally {
    win.destroy();
    await rm(framesDir, { recursive: true, force: true });
  }
}
