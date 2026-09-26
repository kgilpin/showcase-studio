/* Export each showcase as an MP4 video of TikTok's 9:16 frame.
 *
 * Opens /showcase/<id>/record (see that route) and captures it two ways:
 *
 *   default      Frame-by-frame: seeks the page to every 1/FPS moment,
 *                screenshots it at deviceScaleFactor 3 (1080x1920 — TikTok's
 *                9:16 frame), and
 *                assembles the frames with ffmpeg. Slow but deterministic
 *                and full resolution.
 *   --realtime   Quick draft: plays the showcase in real time and records
 *                it with Playwright's built-in screen recording at 360x640.
 *                Fast but capped at viewport resolution.
 *
 * Usage:
 *   npm run dev                        # in one terminal (or any server on BASE_URL)
 *   npm run export:video               # in another — every showcase, frame-by-frame
 *   npm run export:video -- nova       # just the named showcase(s)
 *   npm run export:video -- --realtime nova
 *   npm run export:video -- --prompter nova
 *
 * Output goes to exports/<id>/video.mp4 (or video-draft.mp4 for --realtime).
 * A showcase's soundtrack (meta.soundtrack.src) is looped in when set.
 *
 * --prompter records the teleprompter (/showcase/<id>/script?record=1) instead
 * of the showcase: a 1280x720 real-time capture to exports/<id>/prompter-draft.mp4.
 * The prompter's smooth scrolling runs on the real clock, so this mode is
 * always a real-time draft — there is no frame-by-frame prompter export.
 *
 * Env: BASE_URL (default http://localhost:8080), OUT_DIR (default exports),
 *      FPS (default 30), SCALE (frame-by-frame deviceScaleFactor, default 3).
 */
import { readFile, readdir, mkdir, mkdtemp, rm, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { chromium } from "playwright";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import ffmpegStatic from "ffmpeg-static";

const run = promisify(execFile);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baseUrl = process.env.BASE_URL ?? "http://localhost:8080";
const outRoot = path.resolve(root, process.env.OUT_DIR ?? "exports");
const fps = Number(process.env.FPS ?? 30);
const scale = Number(process.env.SCALE ?? 3);
const ffmpeg = ffmpegStatic ?? "ffmpeg";

const showcasesDir = path.join(root, "showcases");
const available = (await readdir(showcasesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const args = process.argv.slice(2);
const realtime = args.includes("--realtime");
const prompter = args.includes("--prompter");
const requested = args.filter((arg) => !arg.startsWith("--"));
const unknown = requested.filter((id) => !available.includes(id));
if (unknown.length > 0) {
  console.error(`Unknown showcase(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`);
  process.exit(1);
}
const ids = requested.length > 0 ? requested : available;

// Fail fast with a clear message if the dev server isn't running.
try {
  await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
} catch {
  console.error(`Cannot reach ${baseUrl} — start the app first with: npm run dev`);
  process.exit(1);
}

/** ffmpeg args that loop the showcase's soundtrack under the video, if it
 *  has one. `src` may be an asset key (like scene media — resolved to the
 *  file in the showcase's assets/ folder), a root-relative path served by
 *  the app, or a full URL. */
async function audioArgs(soundtrack, id) {
  let src = soundtrack?.src;
  if (!src) return { inputs: [], output: [] };
  if (!/^https?:/.test(src)) {
    if (src.startsWith("/")) {
      src = baseUrl + src;
    } else {
      const assetsDir = path.join(showcasesDir, id, "assets");
      const file = (await readdir(assetsDir).catch(() => [])).find(
        (f) => f === src || f.replace(/\.[^.]+$/, "") === src,
      );
      if (!file) return { inputs: [], output: [] };
      src = path.join(assetsDir, file);
    }
  }
  return {
    inputs: ["-stream_loop", "-1", "-i", src],
    output: ["-shortest", "-af", `volume=${soundtrack.volume ?? 1}`, "-c:a", "aac", "-b:a", "192k"],
  };
}

async function encode(inputArgs, outputArgs, outPath) {
  await run(ffmpeg, ["-y", ...inputArgs, ...outputArgs, outPath], {
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Media duration in seconds, parsed from ffmpeg's own info output. */
async function mediaDuration(file) {
  const stderr = await run(ffmpeg, ["-i", file]).then(
    (r) => r.stderr,
    (error) => error.stderr ?? "",
  );
  const match = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  if (!match) throw new Error(`Cannot read duration of ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/* Temp files go to the OS temp dir, NOT the project — writing files inside
 * the repo while capturing makes the dev server reload the page mid-run. */
function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

/** Approach A: play the page in real time and record the tab. Records the
 *  showcase's /record page by default; `opts` retargets it (the --prompter
 *  mode records /script?record=1 in a desktop-sized viewport instead). */
async function captureRealtime(browser, id, totalMs, soundtrack, outDir, opts = {}) {
  const viewport = opts.viewport ?? { width: 360, height: 640 };
  const url = opts.url ?? `${baseUrl}/showcase/${id}/record`;
  const outName = opts.outName ?? "video-draft.mp4";
  const tmpDir = await tempDir(`showcase-${id}-video-`);
  const context = await browser.newContext({
    viewport,
    recordVideo: { dir: tmpDir, size: viewport },
  });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__record?.ready === true);
  await page.evaluate(() => window.__record.start());
  await page.waitForFunction(() => window.__record?.done === true, undefined, {
    timeout: totalMs + 60_000,
    polling: 100,
  });
  const video = page.video();
  await context.close(); // finalizes the recording
  const webmPath = await video.path();

  // The recording starts before playback does — trim to the played part.
  const totalSec = totalMs / 1000;
  const lead = Math.max(0, (await mediaDuration(webmPath)) - totalSec);
  const outPath = path.join(outDir, outName);
  const audio = await audioArgs(soundtrack, id);
  try {
    await encode(
      ["-ss", lead.toFixed(3), "-i", webmPath, ...audio.inputs],
      [
        "-t",
        totalSec.toFixed(3),
        ...audio.output,
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
      ],
      outPath,
    );
  } catch (error) {
    // Keep the raw recording if the conversion fails.
    await copyFile(webmPath, path.join(outDir, outName.replace(/\.mp4$/, ".webm")));
    throw error;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
  return outPath;
}

/** Approach B: seek to every 1/FPS moment and screenshot it. */
async function captureFrames(browser, id, totalMs, soundtrack, outDir) {
  const framesDir = await tempDir(`showcase-${id}-frames-`);

  const context = await browser.newContext({
    viewport: { width: 360, height: 640 },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  const open = async () => {
    await page.goto(`${baseUrl}/showcase/${id}/record?controlled=1`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__record?.ready === true);
  };
  const captureFrame = async (k) => {
    await page.evaluate((ms) => window.__record.seek(ms), (k * 1000) / fps);
    await page.screenshot({
      path: path.join(framesDir, `frame-${String(k).padStart(5, "0")}.png`),
    });
  };
  await open();

  const frameCount = Math.round((totalMs / 1000) * fps);
  for (let k = 0; k < frameCount; k++) {
    try {
      await captureFrame(k);
    } catch (error) {
      // Seeks are deterministic, so a killed page (e.g. a dev-server reload)
      // can simply be reopened and the frame redone.
      console.warn(`  frame ${k}: ${String(error).split("\n")[0]} — reopening the page`);
      await open();
      await captureFrame(k);
    }
    if ((k + 1) % (fps * 5) === 0 || k + 1 === frameCount) {
      console.log(`  frame ${k + 1}/${frameCount}`);
    }
  }
  await context.close();

  const outPath = path.join(outDir, "video.mp4");
  const audio = await audioArgs(soundtrack, id);
  try {
    await encode(
      ["-framerate", String(fps), "-i", path.join(framesDir, "frame-%05d.png"), ...audio.inputs],
      [
        ...audio.output,
        "-c:v",
        "libx264",
        "-crf",
        "18",
        "-preset",
        "medium",
        "-pix_fmt",
        "yuv420p",
      ],
      outPath,
    );
  } finally {
    await rm(framesDir, { recursive: true, force: true });
  }
  return outPath;
}

const browser = await chromium.launch();

for (const id of ids) {
  const doc = parse(await readFile(path.join(showcasesDir, id, "showcase.yaml"), "utf8"));
  const totalMs = doc.scenes.reduce(
    (sum, scene) => sum + resolveSceneTiming(scene, doc.meta.pace).durationMs,
    0,
  );
  const outDir = path.join(outRoot, id);
  await mkdir(outDir, { recursive: true });

  console.log(
    `Exporting ${id}: ${doc.scenes.length} scenes, ${(totalMs / 1000).toFixed(1)}s ` +
      `(${prompter ? "teleprompter realtime draft" : realtime ? "realtime draft" : `frame-by-frame at ${fps} fps`})`,
  );
  const outPath = prompter
    ? await captureRealtime(browser, id, totalMs, doc.meta.soundtrack, outDir, {
        url: `${baseUrl}/showcase/${id}/script?record=1`,
        viewport: { width: 1280, height: 720 },
        outName: "prompter-draft.mp4",
      })
    : realtime
      ? await captureRealtime(browser, id, totalMs, doc.meta.soundtrack, outDir)
      : await captureFrames(browser, id, totalMs, doc.meta.soundtrack, outDir);
  console.log(`  ${path.relative(root, outPath)}`);
}

await browser.close();
console.log("Done.");
