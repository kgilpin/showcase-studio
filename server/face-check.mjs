/* Captions over faces — the check_framing MCP tool.
 *
 * A phone selfie fills the TikTok frame with the face in the middle,
 * right where the bottom captions go. Nothing in the YAML says where the
 * face is, so the check looks: for every caption on a scene whose
 * picture fills the frame (facesPossible: the same scenes a TikTok fit
 * applies to), it renders the frame at the middle of that
 * caption, the way the video export renders it (screenshotFrame), asks
 * the page where the caption's chip is (window.__record.at().caption.box)
 * and the face finder (faces.mjs) where the faces are, and compares the
 * two boxes. One rectangle test in the page's own geometry, so it can
 * never disagree with the player.
 *
 * Each overlap becomes a warning that says where the face and the
 * caption are and how to fix it: lift the picture with media.tiktok
 * (fill, focus bottom, area.bottom) or move the caption (position: top).
 *
 * The result is cached in <library>/.studio/build/<showcase>.faces.json
 * under the same fingerprint an export records (export-records.mjs:
 * showcase.yaml, the themes, the assets, the graphics, the app
 * version) and CHECK_REVISION, so a validate after an edit only
 * re-renders the showcase that changed. */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { captionTimeline, resolveSceneTiming } from "../src/content/timing.mjs";
import { exportFingerprint, writeRecordFile } from "./export-records.mjs";
import { formatClock, MAX_FRAMES_PER_CALL, screenshotFrame } from "./exporter.mjs";

/** A caption covering less of a face's box than this is a touch, not a
 *  cover: Vision's box reaches a little past the chin. */
export const COVERED_THRESHOLD = 0.05;
/** Raise this when a fix changes what the check sees, so results cached
 *  before the fix aren't given as answers. 2: frames are rendered at
 *  their own time, not at the clip's first frame. */
const CHECK_REVISION = 2;
/** How far the face should clear the caption, in percent of the frame,
 *  and the step the suggested lift is rounded up to: a round number with
 *  room to spare, not the bare minimum. The first hand-made lift was
 *  15% where the minimum was 8%. */
export const CLEAR_MARGIN_PERCENT = 5;
export const LIFT_STEP_PERCENT = 5;

/** Whether a scene's picture can hold a face the captions could cover:
 *  image or video media that takes up the frame — the same scenes a
 *  TikTok fit applies to (src/content/tiktok-fit.ts usesTikTokFit). */
export function facesPossible(scene) {
  const media = scene?.media;
  if (!media || (media.kind !== "image" && media.kind !== "video")) return false;
  if (media.frame === "mark" || scene.theme === "console") return false;
  return scene.theme !== "statement" || media.frame === "full";
}

/** The moments to look at: the middle of every caption on every scene
 *  that can hold a face, in ms from the start of the video, with the
 *  scene's timing resolved the way the video export resolves it. */
export function captionMoments(doc) {
  const moments = [];
  let sceneStart = 0;
  for (const scene of doc.scenes ?? []) {
    const timing = resolveSceneTiming(scene, doc.meta?.pace);
    if (facesPossible(scene)) {
      const timeline = captionTimeline({
        captions: timing.captions,
        durationMs: timing.durationMs,
      });
      timeline.forEach((entry, index) => {
        if (!String(entry.text ?? "").trim()) return;
        moments.push({
          sceneId: scene.id,
          captionIndex: index,
          atMs: Math.round(sceneStart + (entry.startMs + entry.endMs) / 2),
        });
      });
    }
    sceneStart += timing.durationMs;
  }
  return moments;
}

/** The share of `face` that `box` covers, 0–1. Both are {top, left,
 *  width, height} in the same units. */
export function coveredShare(face, box) {
  const width =
    Math.min(face.left + face.width, box.left + box.width) - Math.max(face.left, box.left);
  const height =
    Math.min(face.top + face.height, box.top + box.height) - Math.max(face.top, box.top);
  if (width <= 0 || height <= 0 || !(face.width > 0) || !(face.height > 0)) return 0;
  return (width * height) / (face.width * face.height);
}

/** A percentage written in the YAML ("15%") as a number, else 0. */
function percentOf(value) {
  const match = /^(\d+(?:\.\d+)?)%$/.exec(String(value ?? "").trim());
  return match ? Number(match[1]) : 0;
}

/** The warning for one caption over one face. Percentages are of the
 *  frame's height, from the top. */
export function overlapMessage({ caption, atMs, face, box, covered, lifted = 0 }) {
  const text = caption.text.length > 40 ? `${caption.text.slice(0, 39)}…` : caption.text;
  const faceBottom = face.top + face.height;
  const lift =
    Math.ceil((faceBottom - box.top + CLEAR_MARGIN_PERCENT) / LIFT_STEP_PERCENT) *
    LIFT_STEP_PERCENT;
  const round = (n) => Math.round(n);
  return (
    `Caption ${caption.index + 1} of ${caption.count} ("${text}") sits over the speaker's face at ` +
    `${atMs} ms (${formatClock(atMs)}): the face spans ${round(face.top)}–${round(faceBottom)}% down ` +
    `the frame, the caption ${round(box.top)}–${round(box.top + box.height)}%, covering ` +
    `${Math.round(covered * 100)}% of the face. Lift the picture ${lift}% or more — media.tiktok ` +
    `{fit: fill, focus: bottom, bands: blur, area: {bottom: ${lifted + lift}%}} — or move the ` +
    `caption off it (position: top). Then check with screenshot_frame {atMs: ${atMs}}.`
  );
}

/** Checks one showcase. Returns {checked: [{sceneId, captionIndex,
 *  atMs}], overlaps: [{sceneId, captionIndex, atMs, face, box, covered,
 *  message}], fromCache}. Boxes are in percent of the frame. `finder` is
 *  a face finder (faces.mjs); `cacheFile` keeps the result under the
 *  showcase's fingerprint. */
export async function checkCaptionsOverFaces({
  renderer,
  appUrl,
  showcasesDir,
  showcaseId,
  finder,
  cacheFile,
  appVersion,
}) {
  const fingerprint = cacheFile
    ? exportFingerprint(showcasesDir, showcaseId, { appVersion })
    : null;
  if (cacheFile && existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(readFileSync(cacheFile, "utf8"));
      if (
        cached?.fingerprint === fingerprint &&
        cached.revision === CHECK_REVISION &&
        Array.isArray(cached.checked)
      ) {
        return { checked: cached.checked, overlaps: cached.overlaps ?? [], fromCache: true };
      }
    } catch {
      /* an unreadable cache is re-made */
    }
  }
  const doc = parse(readFileSync(path.join(showcasesDir, showcaseId, "showcase.yaml"), "utf8"));
  const moments = captionMoments(doc ?? {});
  const liftedBy = new Map(
    (doc?.scenes ?? []).map((scene) => [
      scene.id,
      percentOf(scene.media?.tiktok?.area?.bottom ?? doc.meta?.tiktok?.area?.bottom),
    ]),
  );
  const overlaps = [];
  const scratch = mkdtempSync(path.join(os.tmpdir(), `studio-faces-${showcaseId}-`));
  try {
    for (let start = 0; start < moments.length; start += MAX_FRAMES_PER_CALL) {
      const batch = moments.slice(start, start + MAX_FRAMES_PER_CALL);
      const result = await screenshotFrame(renderer, appUrl, showcasesDir, {
        showcaseId,
        atMs: batch.map((moment) => moment.atMs),
      });
      for (const [i, frame] of result.frames.entries()) {
        const moment = batch[i];
        const box = frame.caption?.box;
        if (!box) continue;
        const file = path.join(scratch, `t${moment.atMs}.png`);
        writeFileSync(file, Buffer.from(frame.png, "base64"));
        const faces = (await finder.find(file)).map((face) => ({
          top: face.top * 100,
          left: face.left * 100,
          width: face.width * 100,
          height: face.height * 100,
        }));
        for (const face of faces) {
          const covered = coveredShare(face, box);
          if (covered < COVERED_THRESHOLD) continue;
          const overlap = { ...moment, face, box, covered };
          overlaps.push({
            ...overlap,
            message: overlapMessage({
              caption: frame.caption,
              atMs: moment.atMs,
              face,
              box,
              covered,
              lifted: liftedBy.get(moment.sceneId) ?? 0,
            }),
          });
        }
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const checked = moments;
  if (cacheFile)
    writeRecordFile(cacheFile, { fingerprint, revision: CHECK_REVISION, checked, overlaps });
  return { checked, overlaps, fromCache: false };
}

/** One line for the tool's answer: what was checked and what was found. */
export function facesSummary(showcaseId, { checked, overlaps, fromCache }) {
  const scenes = new Set(checked.map((moment) => moment.sceneId)).size;
  const looked = checked.length
    ? `${checked.length} caption${checked.length === 1 ? "" : "s"} on ${scenes} scene${scenes === 1 ? "" : "s"}`
    : "no captions on a picture that could hold a face";
  const found = overlaps.length
    ? `${overlaps.length} over a face`
    : checked.length
      ? "none over a face"
      : "";
  return `${showcaseId}: ${looked}${found ? `, ${found}` : ""}${fromCache ? " (unchanged since the last check)" : ""}`;
}
