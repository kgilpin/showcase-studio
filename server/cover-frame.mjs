/* A frame of a scene's video, saved as a still for the cover's picture:
 * the Cover page's "From the video" picker. The frame is the scene's own
 * clip at that moment — the picture, without the captions, the brand
 * mark or anything else the video draws over it — written into the
 * showcase's assets/ as cover-<scene>-t<ms>.jpg through encodeAsset, so
 * it reaches assets/ the one safe way ffmpeg output does (written aside,
 * renamed in). The same moment always makes the same file. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { encodeAsset } from "./asset-files.mjs";

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
