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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/** The narration script as share-ready plain text, straight from the
 *  YAML: title header, description, then one block per scene —
 *  "--- Scene N · theme · eyebrow · title" over the indented spoken
 *  lines. Shared by the script MCP tool and the script export. */
export function scriptText(showcasesDir, showcaseId) {
  if (!existsSync(path.join(showcasesDir, showcaseId, "showcase.yaml"))) {
    throw new Error(`No showcase named "${showcaseId}" in ${showcasesDir}`);
  }
  const doc = readDoc(showcasesDir, showcaseId);
  const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
  const title = oneLine(doc.meta?.title ?? showcaseId).toUpperCase();
  const out = [title, "=".repeat(title.length)];
  if (doc.meta?.description) out.push("", oneLine(doc.meta.description));
  (doc.scenes ?? []).forEach((scene, i) => {
    const header = [`Scene ${i + 1}`, scene.theme, scene.eyebrow, scene.title]
      .filter(Boolean)
      .map(oneLine);
    out.push("", `--- ${header.join(" · ")}`);
    for (const caption of scene.captions ?? []) out.push(`    ${oneLine(caption.text)}`);
    if (scene.support) out.push(`    ${oneLine(scene.support)}`);
  });
  return out.join("\n") + "\n";
}

/** Writes the narration script as <id>_script.txt — the instant export. */
export async function exportScript({ showcasesDir, showcaseId, outDir }) {
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${showcaseId}_script.txt`);
  writeFileSync(outPath, scriptText(showcasesDir, showcaseId));
  return outPath;
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
  /** "embed" renders the 4:3 canvas (1440×1080) instead of portrait. */
  canvas = "portrait",
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
  const embed = canvas === "embed";
  const win = embed
    ? draft
      ? studioWindow(720, 540)
      : studioWindow(1440, 1080)
    : draft
      ? studioWindow(660, 1434)
      : studioWindow();
  win.webContents.setFrameRate(60);
  try {
    await win.loadURL(
      `${appUrl}/showcase/${showcaseId}/record?controlled=1${embed ? "&canvas=embed" : ""}`,
    );
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
    // Artifacts are named to survive leaving their folder.
    const suffix = `${embed ? "_43" : ""}${draft ? "_draft" : ""}`;
    const outPath = path.join(outDir, `${showcaseId}${suffix}.mp4`);
    const audio = soundtrackInput({
      showcasesDir,
      showcaseId,
      appUrl,
      soundtrack: doc.meta.soundtrack,
    });
    const seconds = (totalMs / 1000).toFixed(3);
    await new Promise((resolve, reject) => {
      const args = [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        path.join(framesDir, "frame-%06d.png"),
        /* NEVER -stream_loop -1: this ffmpeg build finishes the file and
         * then hangs at exit forever (survives SIGTERM), leaving the
         * export job stuck at "encoding" and the process leaked. The
         * audio is read once and looped in the filter graph instead —
         * a finite input always exits. */
        ...(audio ? ["-i", audio] : []),
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        ...(audio
          ? [
              "-af",
              `aloop=loop=-1:size=2147483647,volume=${doc.meta.soundtrack?.volume ?? 1}`,
              "-c:a",
              "aac",
              "-b:a",
              "192k",
            ]
          : []),
        "-t",
        seconds,
        outPath,
      ];
      // The abort signal kills ffmpeg itself — cancellation between frame
      // captures is cooperative, but a spawned encode needs a real kill.
      const proc = spawn(ffmpeg, args, { stdio: ["ignore", "ignore", "pipe"], signal });
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
