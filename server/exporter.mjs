/* Exports and page captures. Renders the app's own pages with a renderer
 * (server/renderer-playwright.mjs in the dev modes, electron/renderer.mjs
 * in the packaged app) and saves what it draws:
 *
 *   exportScreens    screenshots each scene's /export/<sceneId> page at
 *                    1320×2868 (App Store 6.9") into screens/ — scenes
 *                    with `export: false` are skipped.
 *
 * Screens and videos are written under a partial name and moved into
 * place only when they finish; the previous export is kept, numbered, in
 * the export folder's history/
 * (server/export-output.mjs).
 *   exportVideo      frame-by-frame capture of the /record page (TikTok's
 *                    9:16 frame at 1080×1920, or the 4:3 embed) driven by
 *                    window.__record.seek(), assembled into an MP4 with
 *                    the bundled ffmpeg. Exact but slow. The showcase's
 *                    soundtrack (meta.soundtrack.src) is looped under the
 *                    video when set — frame-by-frame timing starts the
 *                    video at 0, so a timeline-synced voiceover lands
 *                    exactly.
 *   exportScript     the narration as plain text (instant).
 *   screenshotSlide  one slide at half size, for the MCP tool.
 *   validateShowcases loads the library in a fresh page exactly as the app
 *                    does and reports what built and what failed.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import { moveIntoPlace, partialPath, removePartial } from "./export-output.mjs";
import { currentPageError, pageLoadFailureMessage } from "../src/lib/page-error.mjs";
import { VIDEO_FORMATS } from "../src/lib/export-kinds.mjs";

const require_ = createRequire(import.meta.url);
const ffmpeg = require_("ffmpeg-static");

const WIDTH = 1320;
const HEIGHT = 2868;
/* Half App Store size — text is readable, MCP payloads stay small. */
const SHOT = { width: 660, height: 1434 };

/* A page that navigates or crashes can strand in-flight page scripts
 * (they never settle), which would leave a tool call — and Claude —
 * hanging forever. Screenshot and validate race this cap. It is generous
 * because the first capture from source also starts the browser and has
 * the dev server compile the whole app. */
const PAGE_TIMEOUT_MS = 60_000;
const PAGE_ERROR_POLL_MS = 250;

/** Races `promise` against the page timeout. When the page at `path`
 *  fails to render on the server (src/lib/page-error.mjs), it fails at
 *  once with that error instead of waiting out the timeout; a timeout
 *  names the captured page error too, when there is one. */
function withTimeout(promise, message, { path: pagePath } = {}) {
  const started = Date.now();
  let timer;
  let poll;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(pageLoadFailureMessage(message))), PAGE_TIMEOUT_MS);
      if (!pagePath) return;
      poll = setInterval(() => {
        const pageError = currentPageError();
        if (pageError?.path === pagePath && Date.parse(pageError.at) >= started) {
          reject(new Error(pageLoadFailureMessage(message, pageError)));
        }
      }, PAGE_ERROR_POLL_MS);
    }),
  ]).finally(() => {
    clearTimeout(timer);
    clearInterval(poll);
  });
}

/** Cooperative cancellation: exports check the signal between captures. */
function checkAborted(signal) {
  if (signal?.aborted) throw new Error("Export canceled");
}

function requireRenderer(renderer) {
  if (!renderer) throw new Error("This studio has no page renderer, so it can't capture pages");
  return renderer;
}

async function withPage(renderer, size, work) {
  const page = await requireRenderer(renderer).openPage(size);
  try {
    return await work(page);
  } finally {
    await page.close();
  }
}

/* The page renders only after the client fetches the showcase data —
 * wait for the export page to mount, then for fonts, images, and the
 * first frame of any video (footage slides are all video). Then move the
 * scene to its still moment — the end of the scene, graphics fully
 * revealed (window.__still, the export page) — twice around a paint, so
 * an element that mounted late is moved too, and let a paint flush.
 * Videos get a deadline so a broken source still captures. */
const EXPORT_PAGE_READY = `(async () => {
  while (!document.querySelector(".export-static")) await new Promise((r) => setTimeout(r, 50));
  await document.fonts.ready;
  await Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => {})));
  const deadline = Date.now() + 5000;
  while (
    !Array.from(document.querySelectorAll("video")).every((v) => v.readyState >= 2) &&
    Date.now() < deadline
  ) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  await window.__still?.();
  await paint();
  await window.__still?.();
  await paint();
})()`;

/* A seek that crosses a scene boundary mounts a fresh <video>, and setting
 * its currentTime decodes asynchronously — capture before it settles and
 * the frame records the empty stage (a one-frame black flash at the cut).
 * Wait until every video has its frame, with a deadline so a broken
 * source degrades instead of hanging the export. */
const seekScript = (ms) => `(async () => {
  window.__record.seek(${ms});
  const deadline = Date.now() + 2000;
  const settled = (v) => v.readyState >= 2 && !v.seeking;
  while (!Array.from(document.querySelectorAll("video")).every(settled) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
})()`;

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
  renderer,
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
  // An empty set would replace the previous one with an empty folder.
  if (scenes.length === 0) {
    throw new Error(
      `${showcaseId} has no scenes in its screenshot set — every scene has export: false ` +
        `(or is footage). Set export: true on the scenes to capture.`,
    );
  }
  // The set goes in screens/; the previous set is kept as history/screens.1.
  const finalDir = path.join(outDir, "screens");
  const partial = partialPath(finalDir, { isDir: true });
  removePartial(partial);
  mkdirSync(partial, { recursive: true });
  try {
    await withPage(renderer, { width: WIDTH, height: HEIGHT }, async (page) => {
      for (const [i, scene] of scenes.entries()) {
        checkAborted(signal);
        const name = `${String(i + 1).padStart(2, "0")}-${scene.id}.png`;
        await page.goto(`${appUrl}/showcase/${showcaseId}/export/${scene.id}`);
        await page.evaluate(EXPORT_PAGE_READY);
        writeFileSync(path.join(partial, name), await page.capture());
        progress?.(`screenshot ${i + 1}/${scenes.length}: ${name}`, {
          step: i + 1,
          steps: scenes.length,
        });
      }
    });
    checkAborted(signal);
    return moveIntoPlace(partial, finalDir);
  } catch (error) {
    removePartial(partial);
    throw error;
  }
}

export async function exportVideo({
  renderer,
  showcasesDir,
  showcaseId,
  appUrl,
  outDir,
  fps = 30,
  /** Draft mode: half size, meant for low fps — a fast check render. */
  draft = false,
  /** "embed" renders the 4:3 canvas (1440×1080) instead of TikTok's 9:16. */
  canvas = "tiktok",
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
  const embed = canvas === "embed";
  /* The TikTok video is 9:16, TikTok's own shape; drafts are half size. */
  const { width, height } =
    VIDEO_FORMATS[`${embed ? "video-43" : "video"}${draft ? "-draft" : ""}`];
  const size = { width, height };
  const framesDir = await mkdtemp(path.join(os.tmpdir(), `studio-${showcaseId}-`));
  try {
    await withPage(renderer, size, async (page) => {
      await page.goto(
        `${appUrl}/showcase/${showcaseId}/record?controlled=1${embed ? "&canvas=embed" : ""}`,
      );
      await page.evaluate(`(async () => {
        while (window.__record?.ready !== true) await new Promise((r) => setTimeout(r, 100));
      })()`);
      for (let frame = 0; frame < frameCount; frame++) {
        checkAborted(signal);
        const ms = Math.min((frame / fps) * 1000, totalMs);
        await page.evaluate(seekScript(ms));
        writeFileSync(
          path.join(framesDir, `frame-${String(frame).padStart(6, "0")}.png`),
          await page.capture(),
        );
        if (frame % fps === 0) {
          progress?.(`frame ${frame + 1}/${frameCount} (${Math.round(ms / 1000)}s)`, {
            step: frame + 1,
            steps: frameCount,
          });
        }
      }
    });
    checkAborted(signal);
    progress?.(`encoding ${frameCount} frames…`);
    // Artifacts are named to survive leaving their folder.
    const suffix = `${embed ? "_43" : ""}${draft ? "_draft" : ""}`;
    const outPath = path.join(outDir, `${showcaseId}${suffix}.mp4`);
    // Encoded under a partial name; the previous export is kept as .1.
    const partial = partialPath(outPath);
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
        partial,
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
    }).catch((error) => {
      removePartial(partial);
      throw error;
    });
    if (signal?.aborted) removePartial(partial);
    checkAborted(signal);
    return moveIntoPlace(partial, outPath);
  } finally {
    await rm(framesDir, { recursive: true, force: true });
  }
}

/** The frame rate a video export renders at: its format's (12 for
 *  drafts, 30 otherwise), or EXPORT_FPS when set, for tuning. */
export function videoFps(kind) {
  return Number(process.env.EXPORT_FPS ?? VIDEO_FORMATS[kind]?.fps ?? 30);
}

/** Runs one export. Kinds: screens, script, video, video-draft, and the
 *  4:3 embed canvas video-43 / video-43-draft. Drafts run 12fps at half
 *  size (EXPORT_FPS overrides the frame rate, for tuning). onProgress
 *  gets a label and, while there is something to count, { step, steps }. */
export function runExport({
  renderer,
  appUrl,
  showcasesDir,
  kind,
  showcaseId,
  outDir,
  onProgress,
  signal,
}) {
  const options = {
    renderer,
    showcasesDir,
    showcaseId,
    appUrl,
    outDir,
    progress: onProgress,
    signal,
  };
  if (kind === "screens") return exportScreens(options);
  if (kind === "script") return exportScript(options);
  return exportVideo({
    ...options,
    draft: kind.endsWith("-draft"),
    canvas: kind.startsWith("video-43") ? "embed" : "tiktok",
    fps: videoFps(kind),
  });
}

/** One slide's export page, rendered at half size — returns base64 PNG. */
export function screenshotSlide(renderer, appUrl, { showcaseId, sceneId } = {}) {
  if (!showcaseId || !sceneId) throw new Error("showcaseId and sceneId are both required");
  const pagePath = `/showcase/${showcaseId}/export/${sceneId}`;
  return withTimeout(
    withPage(renderer, SHOT, async (page) => {
      await page.goto(`${appUrl}${pagePath}`);
      await page.evaluate(EXPORT_PAGE_READY);
      return (await page.capture()).toString("base64");
    }),
    `The slide did not render — check the showcase id ("${showcaseId}") and scene id ` +
      `("${sceneId}"), and whether the showcase loads at all (run validate).`,
    { path: pagePath },
  );
}

/** Loads the library in a fresh page exactly as the app does and reports
 *  what built, what didn't, and the theme linter's warnings. The page
 *  publishes its library as window.__showcaseLibrary
 *  (src/content/showcases.ts), so this works in every mode, packaged app
 *  included. */
export function validateShowcases(renderer, appUrl) {
  return withTimeout(
    withPage(renderer, SHOT, async (page) => {
      await page.goto(`${appUrl}/`);
      return page.evaluate(`(async () => {
        while (!window.__showcaseLibrary) await new Promise((r) => setTimeout(r, 100));
        const { showcases, errors, warnings } = await window.__showcaseLibrary();
        return {
          loaded: showcases.map((s) => ({
            id: s.id,
            title: s.title,
            slides: s.scenes.length,
            runtimeSeconds: Math.round(s.scenes.reduce((sum, x) => sum + x.durationMs, 0) / 1000),
          })),
          errors,
          warnings,
        };
      })()`);
    }),
    "The library did not finish loading — is the studio's app page reachable?",
    { path: "/" },
  );
}
