/* The cover's picture, taken from a moment of the video: the Cover page's
 * "From the video" picker (the studio's "cover-picture" action) and
 * Claude's save_cover_picture tool both call saveCoverPicture, which
 * decides what kind of still that moment gives:
 *
 *   the scene's media       what is saved
 *   video                   a frame of the clip (saveCoverFrame)
 *   image                   nothing: the image itself is the picture
 *   none, or a graphic      the whole scene as drawn (saveCoverScene)
 *   any, with whole: true   the whole scene as drawn
 *
 * saveCoverFrame: a frame of a scene's video. The frame is the scene's own
 * clip at that moment — the picture, without the captions, the brand
 * mark or anything else the video draws over it — written into the
 * showcase's assets/ as cover-<scene>-t<ms>.jpg through encodeAsset, so
 * it reaches assets/ the one safe way ffmpeg output does (written aside,
 * renamed in). The same moment always makes the same file.
 *
 * saveCoverScene makes the other kind of still: the whole scene as the
 * video draws it at a moment, for a scene that is text or a graphic, or
 * when the slide around the picture is wanted too: in the TikTok 9:16
 * frame (1080×1920) or the 4:3 embed (1440×1080). The title, the captions
 * and the brand mark are each the caller's choice; the picker leaves all
 * three out by default, since the cover draws its own headline. It is
 * written as cover-<scene>[-43]-at<ms>[-title][-captions][-mark].png. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import { encodeAsset, writeAsset } from "./asset-files.mjs";
import { mediaDuration } from "./ffmpeg.mjs";

/** A scene can be pinned a hair longer than its clip. Up to two frames
 *  over holds the clip's last frame (src/lib/record-seek.ts). */
const CLIP_END_SLACK_S = 2 / 30;

/** Where a clip is, in seconds, `elapsedMs` into its scene: the player's
 *  rule (clipTimeS in src/lib/record-seek.ts, which this copies, since
 *  the server can't import the page's TypeScript). A clip shorter than
 *  its scene holds its last frame, or loops when the scene is longer by
 *  more than the slack. */
export function clipSeconds({ elapsedMs, sceneMs, clipS, speed = 1 }) {
  const seconds = (elapsedMs / 1000) * speed;
  if (!clipS || seconds < clipS) return seconds;
  const loops = (sceneMs / 1000) * speed > clipS + CLIP_END_SLACK_S;
  if (!loops || seconds < clipS + 1 / 30) return clipS;
  return seconds % clipS;
}

/** The file in assets/ an asset key names: the key with any extension,
 *  or the full file name. */
function assetFile(assetsDir, key) {
  if (!existsSync(assetsDir)) return undefined;
  const files = readdirSync(assetsDir);
  return (
    files.find((file) => file === key) ??
    files.find((file) => file.slice(0, file.length - path.extname(file).length) === key)
  );
}

/** Saves the frame of scene `sceneId`'s video at `clipMs` — a time in
 *  the clip file itself, which the page works out from the scene's
 *  timeline and the clip's speed. Returns { ok: true, asset: { name,
 *  key }, replaced } or { ok: false, error }. */
export async function saveCoverFrame(showcasesDir, { showcaseId, sceneId, clipMs } = {}, options) {
  const id = String(showcaseId ?? "");
  if (!id || /[/\\]|\.\./.test(id)) return { ok: false, error: "Bad showcase id" };
  const file = path.join(showcasesDir, id, "showcase.yaml");
  if (!existsSync(file)) return { ok: false, error: `No showcase named "${id}"` };
  const ms = Number(clipMs);
  if (!Number.isFinite(ms) || ms < 0) {
    return { ok: false, error: "clipMs must be a time in the clip, in milliseconds" };
  }
  let doc;
  try {
    doc = parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, error: `showcase.yaml doesn't read: ${String(error?.message ?? error)}` };
  }
  const scene = (doc?.scenes ?? []).find((s) => s?.id === sceneId);
  if (!scene) return { ok: false, error: `No scene "${String(sceneId)}" in ${id}` };
  if (scene.media?.kind !== "video" || typeof scene.media.asset !== "string") {
    return { ok: false, error: `Scene "${sceneId}" has no video to take a frame from` };
  }
  const source = assetFile(path.join(showcasesDir, id, "assets"), scene.media.asset);
  if (!source) return { ok: false, error: `No asset named "${scene.media.asset}" in assets/` };
  const rounded = Math.round(ms);
  return encodeAsset(
    showcasesDir,
    {
      showcaseId: id,
      output: `cover-${sceneId}-t${String(rounded).padStart(6, "0")}.jpg`,
      args: [
        "-ss",
        (rounded / 1000).toFixed(3),
        "-i",
        path.join("assets", source),
        "-frames:v",
        "1",
        "-q:v",
        "2",
      ],
    },
    options,
  );
}

/** The file a whole-scene still gets: the scene, the moment in the
 *  video, and which of the optional parts it shows. */
export function coverSceneFileName(sceneId, atMs, { view, title, captions, mark } = {}) {
  const parts = [
    `cover-${sceneId}${view === "43" ? "-43" : ""}-at${String(Math.round(atMs)).padStart(6, "0")}`,
  ];
  if (title) parts.push("title");
  if (captions) parts.push("captions");
  if (mark) parts.push("mark");
  return `${parts.join("-")}.png`;
}

/** Saves the whole scene at `atMs` (a time in the video, from its start)
 *  as a still in assets/. `view` is "tiktok" (9:16, the default) or "43"
 *  (the 4:3 embed). `title`, `captions` and `mark` say whether each is
 *  drawn (all default false). `capture` renders the frame: it takes
 *  screenshotFrame's options and resolves to its result,
 *  { frames: [{ png, scene }] } (server/exporter.mjs; the studio binds
 *  its renderer). Returns { ok: true, asset: { name, key }, replaced } or
 *  { ok: false, error }. */
export async function saveCoverScene(
  showcasesDir,
  { showcaseId, atMs, view = "tiktok", title = false, captions = false, mark = false } = {},
  { capture } = {},
) {
  if (view !== "tiktok" && view !== "43")
    return { ok: false, error: 'view must be "tiktok" or "43"' };
  const id = String(showcaseId ?? "");
  if (!id || /[/\\]|\.\./.test(id)) return { ok: false, error: "Bad showcase id" };
  if (!existsSync(path.join(showcasesDir, id, "showcase.yaml"))) {
    return { ok: false, error: `No showcase named "${id}"` };
  }
  const ms = Number(atMs);
  if (atMs == null || !Number.isFinite(ms) || ms < 0) {
    return { ok: false, error: "atMs must be a time in the video, in milliseconds" };
  }
  if (typeof capture !== "function") {
    return { ok: false, error: "This studio has no page renderer, so it can't draw the scene" };
  }
  const parts = { title: title === true, captions: captions === true, mark: mark === true };
  let frame;
  try {
    const result = await capture({
      showcaseId: id,
      atMs: Math.round(ms),
      view,
      size: "full",
      animations: "finished",
      ...parts,
    });
    frame = result?.frames?.[0];
  } catch (error) {
    return { ok: false, error: String(error?.message ?? error) };
  }
  if (!frame?.png || !frame.scene?.id) return { ok: false, error: "The scene did not render" };
  return writeAsset(showcasesDir, {
    showcaseId: id,
    name: coverSceneFileName(frame.scene.id, ms, { view, ...parts }),
    data: Buffer.from(frame.png, "base64"),
  });
}

/** The change-log entry for a saved cover picture: the clip frame as an
 *  encode, the whole scene as an added file, the scene's own image as
 *  nothing (no file was written). The studio and the MCP tool each add
 *  their own source. */
export function coverPictureLog(result) {
  if (result.kind === "frame") {
    return { kind: "asset.encode", name: result.asset.name, replaced: result.replaced };
  }
  if (result.kind === "scene") return { kind: "asset.add", names: [result.asset.name] };
  return undefined;
}

/** The scene at `atMs` into the video, and how far into it: each
 *  scene's length as the player times it (resolveSceneTiming). */
function sceneAt(doc, atMs) {
  let start = 0;
  const scenes = doc?.scenes ?? [];
  for (const scene of scenes) {
    const durationMs = resolveSceneTiming(scene, doc.meta?.pace).durationMs;
    if (atMs < start + durationMs) return { scene, elapsedMs: atMs - start, durationMs };
    start += durationMs;
  }
  return { totalMs: start };
}

/** Saves the cover's picture from the moment `atMs` of the video (ms from
 *  its start), by the rule in this file's header. `whole: true` takes
 *  the whole scene even when it has a picture of its own. For a whole
 *  scene: `view` is "tiktok" (9:16) or "43" (the 4:3 video), defaulting
 *  to 4:3 for a showcase whose meta.view is embed and 9:16 otherwise;
 *  `title`, `captions` and `mark` are drawn only when true. `capture`
 *  renders a whole scene (see saveCoverScene); `ffmpeg` names another
 *  binary (tests). Returns { ok: true, kind: "frame" | "image" | "scene",
 *  sceneId, asset: { name, key }, replaced? } or { ok: false, error }. */
export async function saveCoverPicture(
  showcasesDir,
  { showcaseId, atMs, whole = false, view, title = false, captions = false, mark = false } = {},
  { capture, ffmpeg } = {},
) {
  const id = String(showcaseId ?? "");
  if (!id || /[/\\]|\.\./.test(id)) return { ok: false, error: "Bad showcase id" };
  const file = path.join(showcasesDir, id, "showcase.yaml");
  if (!existsSync(file)) return { ok: false, error: `No showcase named "${id}"` };
  const ms = Number(atMs);
  if (atMs == null || !Number.isFinite(ms) || ms < 0) {
    return { ok: false, error: "atMs must be a time in the video, in milliseconds" };
  }
  if (view != null && view !== "tiktok" && view !== "43") {
    return { ok: false, error: 'view must be "tiktok" or "43"' };
  }
  let doc;
  try {
    doc = parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { ok: false, error: `showcase.yaml doesn't read: ${String(error?.message ?? error)}` };
  }
  const { scene, elapsedMs, durationMs, totalMs } = sceneAt(doc, ms);
  if (!scene) {
    return {
      ok: false,
      error: totalMs
        ? `${Math.round(ms)} ms is past the end of "${id}", which runs ${totalMs} ms`
        : `"${id}" has no scenes`,
    };
  }
  const sceneId = String(scene.id);
  const media = scene.media ?? {};
  const asset = typeof media.asset === "string" ? media.asset : undefined;
  if (!whole && media.kind === "image" && asset) {
    const name = assetFile(path.join(showcasesDir, id, "assets"), asset);
    if (!name) return { ok: false, error: `No asset named "${asset}" in assets/` };
    return { ok: true, kind: "image", sceneId, asset: { name, key: asset } };
  }
  if (!whole && media.kind === "video" && asset) {
    const source = assetFile(path.join(showcasesDir, id, "assets"), asset);
    if (!source) return { ok: false, error: `No asset named "${asset}" in assets/` };
    const clipS = await mediaDuration(
      path.join(showcasesDir, id, "assets", source),
      ffmpeg ? { ffmpeg } : {},
    ).catch(() => undefined);
    let seconds = clipSeconds({
      elapsedMs,
      sceneMs: durationMs,
      clipS,
      speed: Number(media.speed) || 1,
    });
    /* The held last frame: ffmpeg finds nothing at the clip's very end. */
    if (clipS) seconds = Math.min(seconds, Math.max(0, clipS - 0.05));
    const result = await saveCoverFrame(
      showcasesDir,
      { showcaseId: id, sceneId, clipMs: seconds * 1000 },
      ffmpeg ? { ffmpeg } : undefined,
    );
    return result.ok ? { ...result, kind: "frame", sceneId } : result;
  }
  const result = await saveCoverScene(
    showcasesDir,
    {
      showcaseId: id,
      atMs: ms,
      view: view ?? (doc.meta?.view === "embed" ? "43" : "tiktok"),
      title,
      captions,
      mark,
    },
    { capture },
  );
  return result.ok ? { ...result, kind: "scene", sceneId } : result;
}
