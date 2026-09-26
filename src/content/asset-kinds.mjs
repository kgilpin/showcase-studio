/* Which file extensions a showcase can play or draw, and what kind each
 * one is. Plain ESM with no imports, like watermark-rules.mjs, so the
 * page (src/content/asset-kind.ts) and the studio's asset writer
 * (server/asset-files.mjs) read one copy. Types: asset-kinds.d.mts. */

export const ASSET_KINDS = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  gif: "image",
  svg: "image",
  mp4: "video",
  mov: "video",
  webm: "video",
  m4v: "video",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  aac: "audio",
  ogg: "audio",
};
