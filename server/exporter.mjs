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
 *   titleCheck       the slide titles alone, for the check_titles tool.
 *   screenshotSlide  one slide at half size, for the MCP tool.
 *   screenshotCover  the showcase's cover (cover.yaml) as a PNG, for the
 *                    Cover page's Save button and the screenshot_cover
 *                    tool.
 *   screenshotFrame  one frame of the video at a given time (the record
 *                    page the video export records, in the TikTok 9:16
 *                    or 4:3 embed view), for the screenshot_frame MCP
 *                    tool and the player's Frame button (which gets it
 *                    from GET /studio/api/frame). Animations are
 *                    finished unless asked for live; TikTok's safe area
 *                    is shaded on request.
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
import { findTemplate } from "./showcase-templates.mjs";
import { currentPageError, pageLoadFailureMessage } from "../src/lib/page-error.mjs";
import { VIDEO_FORMATS } from "../src/lib/export-kinds.mjs";
import { COVER_DESTINATIONS, coverImage } from "../src/content/cover-rules.mjs";

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

/** A PNG's width and height, from its header. */
export function pngSize(png) {
  if (png.length < 24 || png.toString("latin1", 12, 16) !== "IHDR") return undefined;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** A JPEG's width and height, from its first frame header (SOF0–SOF15,
 *  less the markers that aren't frames), or undefined for anything that
 *  isn't a JPEG. */
export function jpegSize(jpeg) {
  if (jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return undefined;
  let at = 2;
  while (at + 9 < jpeg.length) {
    if (jpeg[at] !== 0xff) return undefined;
    const marker = jpeg[at + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { width: jpeg.readUInt16BE(at + 7), height: jpeg.readUInt16BE(at + 5) };
    }
    at += 2 + jpeg.readUInt16BE(at + 2);
  }
  return undefined;
}

/* Every capture must be exactly the size asked for. A renderer that draws
 * at the wrong pixel density would otherwise write a small, blurry export
 * without a word (issue #22), so a wrong size stops the export. */
async function withPage(renderer, size, work) {
  const page = await requireRenderer(renderer).openPage(size);
  const capture = async ({ format = "png" } = {}) => {
    const image = await page.capture({ format });
    const got = format === "jpeg" ? jpegSize(image) : pngSize(image);
    if (got?.width !== size.width || got?.height !== size.height) {
      throw new Error(
        `The page renderer drew ${got ? `${got.width}×${got.height}` : `something that isn't a ${format.toUpperCase()}`}, ` +
          `not ${size.width}×${size.height}, so the export would be the wrong size`,
      );
    }
    return image;
  };
  try {
    return await work({ ...page, capture });
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
export const seekScript = (ms) => `(async () => {
  const settled = (v) => v.readyState >= 2 && !v.seeking;
  const deadline = Date.now() + 2000;
  for (let pass = 0; pass < 4; pass++) {
    window.__record.seek(${ms});
    const placed = new Set(document.getAnimations());
    while (!Array.from(document.querySelectorAll("video")).every(settled) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    /* Some animations don't exist until a paint: a graphic's inside a
     * size container, an overlay's that shows once its picture is
     * measured. They would be captured at their first frame, so when the
     * paint brought a new one, seek again. */
    if (document.getAnimations().every((animation) => placed.has(animation))) break;
  }
})()`;

/* The record page says when its fonts are loaded and its images decoded.
 * Waits up to 30 s, then answers with the page's own text instead of
 * hanging: the page never becomes ready when the showcase fails to build
 * or the studio shows a "No showcase named …" page. */
const RECORD_PAGE_READY = `(async () => {
  const deadline = Date.now() + 30000;
  while (window.__record?.ready !== true && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }
  if (window.__record?.ready === true) return null;
  return { notReady: true, text: (document.body?.innerText ?? "").trim().slice(0, 200) };
})()`;

/** Throws when RECORD_PAGE_READY answered that the page never got ready. */
function requireRecordPage(answer, showcaseId) {
  if (!answer?.notReady) return;
  throw new Error(
    `The video page for "${showcaseId}" never became ready (does the showcase load? run validate).` +
      (answer.text ? ` The page says: ${answer.text}` : ""),
  );
}

/* Every animation moved to its end, so marks and captions show in their
 * fully revealed state — the still of a frame, the way the screens
 * export shows a slide. Twice around a paint, like the export page's
 * __still, so an animation an element started after the seek is moved
 * too. An animation that never ends (a pulse) refuses finish() and
 * stays where the seek put it. */
const FINISH_ANIMATIONS = `(async () => {
  const paint = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const finish = () => {
    for (const animation of document.getAnimations()) {
      try { animation.finish(); } catch {}
    }
  };
  finish();
  await paint();
  finish();
  await paint();
})()`;

/* What the record page shows now: {scene: {id, index, count, elapsedMs,
 * durationMs}, caption?: {index, count, text}}. */
const FRAME_INFO = `window.__record?.at?.()`;

function readDoc(showcasesDir, showcaseId) {
  const file = path.join(showcasesDir, showcaseId, "showcase.yaml");
  if (!existsSync(file)) throw new Error(`No showcase named "${showcaseId}" in the library`);
  return parse(readFileSync(file, "utf8"));
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

/** The title check: the slide titles alone, for a reader who has seen
 *  nothing else. `brief` is the whole prompt for that reader — the
 *  titles in order, numbered, and the question to answer. `slides` maps
 *  each number back to its scene, with the scene's note, so the writer
 *  can compare each answer with what the slide was meant to show.
 *  Scenes with no title (footage) are left out of both. */
export function titleCheck(showcasesDir, showcaseId) {
  if (!existsSync(path.join(showcasesDir, showcaseId, "showcase.yaml"))) {
    throw new Error(`No showcase named "${showcaseId}" in ${showcasesDir}`);
  }
  const doc = readDoc(showcasesDir, showcaseId);
  const oneLine = (s) => String(s).replace(/\s+/g, " ").trim();
  const slides = (doc.scenes ?? [])
    .filter((scene) => scene?.title && oneLine(scene.title))
    .map((scene, i) => ({
      slide: i + 1,
      sceneId: scene.id,
      title: oneLine(scene.title),
      ...(scene.note ? { note: oneLine(scene.note) } : {}),
    }));
  /* A template whose titles tell a story (titleCheck: story) asks the
   * reader to retell it; every other showcase asks what each slide shows. */
  const templateId = doc.meta?.template;
  const check =
    (templateId && findTemplate(showcasesDir, String(templateId))?.titleCheck) || "screen";
  const question =
    check === "story"
      ? [
          "In a few sentences, retell what happens in this video, as you understand it from the titles.",
          "Then list each slide whose title you couldn't fit into that story, and say why.",
        ]
      : [
          "For each slide, say in one sentence what you expect to see on the screen.",
          "If a title doesn't tell you, write \"Can't tell\" and say what is missing.",
        ];
  const brief = [
    "Below are the on-screen titles of the slides in a short product video, in order.",
    "You know nothing else about the video or the product. Answer from the titles alone.",
    "",
    ...question,
    "",
    ...slides.map((s) => `${s.slide}. ${s.title}`),
  ].join("\n");
  return { brief, check, slides };
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
  /** The id of the snapshot `showcasesDir` is (server/export-snapshot.mjs):
   *  the record page reads the showcase from it too, so an edit made
   *  while the frames render changes nothing the video shows. */
  snapshot,
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
        `${appUrl}/showcase/${showcaseId}/record?controlled=1${embed ? "&canvas=embed" : ""}` +
          (snapshot ? `&snapshot=${encodeURIComponent(snapshot)}` : ""),
      );
      requireRecordPage(await page.evaluate(RECORD_PAGE_READY), showcaseId);
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
  snapshot,
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
    snapshot,
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

/** A showcase's cover as an image (`/showcase/<id>/cover/still`): one
 *  destination's cover, or the default, graphics drawn finished. Full
 *  size is the cover itself — 1080×1920, or YouTube's 1280×720 thumbnail
 *  (the Cover page's Save button); half size is for the screenshot_cover
 *  tool. Returns the image's bytes: a PNG, or a JPEG for the destinations
 *  that take one (coverImage in cover-rules.mjs). */
export async function screenshotCover(
  renderer,
  appUrl,
  showcasesDir,
  { showcaseId, destination, size = "full" } = {},
) {
  if (!showcaseId) throw new Error("showcaseId is required");
  if (destination != null && !Object.hasOwn(COVER_DESTINATIONS, destination)) {
    throw new Error(
      `No cover destination "${destination}" — use one of: ${Object.keys(COVER_DESTINATIONS).join(", ")}`,
    );
  }
  if (size !== "half" && size !== "full") throw new Error('size must be "half" or "full"');
  if (!existsSync(path.join(showcasesDir, showcaseId, "showcase.yaml"))) {
    throw new Error(`No showcase named "${showcaseId}"`);
  }
  if (!existsSync(path.join(showcasesDir, showcaseId, "cover.yaml"))) {
    throw new Error(
      `"${showcaseId}" has no cover yet — make one with edit_cover (or the Cover page)`,
    );
  }
  const scale = size === "half" ? 0.5 : 1;
  const image = coverImage(destination);
  const pagePath = `/showcase/${showcaseId}/cover/still`;
  const query = destination ? `?destination=${destination}` : "";
  return withTimeout(
    withPage(
      renderer,
      { width: image.width * scale, height: image.height * scale },
      async (page) => {
        await page.goto(`${appUrl}${pagePath}${query}`);
        await page.evaluate(EXPORT_PAGE_READY);
        return page.capture({ format: image.format });
      },
    ),
    `The cover did not render — check the showcase id ("${showcaseId}"), and whether the ` +
      "showcase loads at all (run validate).",
    { path: pagePath },
  );
}

/** The file a saved cover gets: nova-cover.png, nova-cover-instagram.png,
 *  nova-cover-youtube43.jpg. */
export function coverFileName(showcaseId, destination) {
  const extension = coverImage(destination).format === "jpeg" ? "jpg" : "png";
  return `${showcaseId}-cover${destination ? `-${destination}` : ""}.${extension}`;
}

/** The most frames one screenshot_frame call renders: a review checks a
 *  handful of moments, and each frame is an image in the reply. */
export const MAX_FRAMES_PER_CALL = 10;

/** One or more frames of the video at given times, as the video export
 *  would render them: the record page at the TikTok 9:16 frame
 *  (`view: "tiktok"`, 1080×1920) or the 4:3 embed (`view: "43"`,
 *  1440×1080), rendered at half size unless `size: "full"`. Animations
 *  are moved to their end (`animations: "finished"`, the screens
 *  export's convention) so an overlay's resting state is what the still
 *  shows; `"live"` leaves them where the clock has them at that moment.
 *  `safeArea` shades where TikTok's own interface sits (TikTok view
 *  only), like the player's switch. Returns the frames in the order
 *  asked, each with its base64 PNG and what the page says it shows
 *  (window.__record.at(): the scene and the caption on it). A check,
 *  not a deliverable: no export record, no license. */
export async function screenshotFrame(
  renderer,
  appUrl,
  showcasesDir,
  {
    showcaseId,
    atMs,
    view = "tiktok",
    animations = "finished",
    safeArea = false,
    size = "half",
  } = {},
) {
  if (!showcaseId) throw new Error("showcaseId is required");
  if (view !== "tiktok" && view !== "43") throw new Error('view must be "tiktok" or "43"');
  if (animations !== "finished" && animations !== "live") {
    throw new Error('animations must be "finished" or "live"');
  }
  if (size !== "half" && size !== "full") throw new Error('size must be "half" or "full"');
  const times = (Array.isArray(atMs) ? atMs : [atMs]).map(Number);
  if (times.length === 0 || atMs == null)
    throw new Error("atMs is required: a time in ms, or a list of them");
  if (times.some((ms) => !Number.isFinite(ms) || ms < 0)) {
    throw new Error(
      "atMs must be a time in milliseconds from the start of the video, or a list of them",
    );
  }
  if (times.length > MAX_FRAMES_PER_CALL) {
    throw new Error(`At most ${MAX_FRAMES_PER_CALL} frames per call (asked for ${times.length})`);
  }
  const doc = readDoc(showcasesDir, showcaseId);
  if (!doc.scenes?.length) throw new Error(`"${showcaseId}" has no scenes`);
  const totalMs = doc.scenes.reduce(
    (sum, scene) => sum + resolveSceneTiming(scene, doc.meta?.pace).durationMs,
    0,
  );
  const late = times.find((ms) => ms > totalMs);
  if (late !== undefined) {
    throw new Error(
      `${late} ms is past the end of "${showcaseId}", which runs ${totalMs} ms (${formatClock(totalMs)})`,
    );
  }
  const embed = view === "43";
  const shaded = safeArea === true && !embed;
  const { width, height } =
    VIDEO_FORMATS[`${embed ? "video-43" : "video"}${size === "half" ? "-draft" : ""}`];
  const pagePath = `/showcase/${showcaseId}/record`;
  const query = new URLSearchParams({ controlled: "1" });
  if (embed) query.set("canvas", "embed");
  if (shaded) query.set("safeArea", "1");
  return withTimeout(
    withPage(renderer, { width, height }, async (page) => {
      await page.goto(`${appUrl}${pagePath}?${query}`);
      requireRecordPage(await page.evaluate(RECORD_PAGE_READY), showcaseId);
      const frames = [];
      for (const ms of times) {
        await page.evaluate(seekScript(ms));
        if (animations === "finished") await page.evaluate(FINISH_ANIMATIONS);
        const shows = (await page.evaluate(FRAME_INFO)) ?? {};
        frames.push({ atMs: ms, ...shows, png: (await page.capture()).toString("base64") });
      }
      return {
        view,
        width,
        height,
        size,
        animations,
        safeArea: shaded,
        totalMs,
        frames,
      };
    }),
    `The video page did not render — check the showcase id ("${showcaseId}"), and whether the ` +
      "showcase loads at all (run validate).",
    { path: pagePath },
  );
}

/** The file a saved frame gets: nova-t024500.png, nova-43-t024500.png
 *  (the time zero-padded so the files sort by time). */
export function frameFileName(showcaseId, view, ms) {
  return `${showcaseId}-${view === "43" ? "43-" : ""}t${String(Math.round(ms)).padStart(6, "0")}.png`;
}

/** 24500 → "0:24.5": minutes, seconds and tenths, as the player's scrubber shows time. */
export function formatClock(ms) {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const minutes = Math.floor(tenths / 600);
  const seconds = Math.floor((tenths % 600) / 10);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
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
            ...(s.targetMs != null ? { targetSeconds: Math.round(s.targetMs / 1000) } : {}),
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
