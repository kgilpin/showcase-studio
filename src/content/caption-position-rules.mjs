/* Where an overlay caption may sit. Plain ESM with no imports, like
 * watermark-rules.mjs, so the loader (src/content/showcases.ts) and the
 * studio's edit tool (server/edit-yaml.mjs) read one copy. Types live in
 * caption-position-rules.d.mts.
 *
 * A position is a named preset or an exact height, "14%": the caption's
 * top edge sits that far down the slide, in every format.
 *
 * A preset says what the author means ("at the bottom"), and each format
 * picks the height. The portrait format is the TikTok video, and TikTok
 * covers about the top 13% (status bar, tabs) and the bottom 25%
 * (username, description, buttons) with its own interface, so its top
 * and bottom stay inside 13%–75%. The 4:3 embed has nothing laid over
 * it, so its captions sit nearer the edges.
 *
 *   preset    portrait (TikTok)            4:3
 *   ------    -------------------------    ----------------
 *   top       top edge 13% down            top edge 6% down
 *   center    centered                     centered
 *   lower     centered 60% down            centered 60% down
 *   bottom    bottom edge 25% up (default) bottom edge 8% up
 *
 * The heights themselves are in SceneView.tsx (portrait) and
 * EmbedSceneView.tsx (4:3). */

export const CAPTION_PRESETS = ["top", "center", "lower", "bottom"];

/** How far down an exact height may go, ends included. Past 90% the
 *  line would run off the bottom of the slide. */
export const CAPTION_PERCENT = { min: 0, max: 90 };

const PERCENT = /^(\d+(?:\.\d+)?)%$/;

/** The top edge, in percent, of an exact-height position ("14%" → 14),
 *  or null when `value` isn't one (a preset, or not a position). */
export function captionPercent(value) {
  const match = typeof value === "string" ? PERCENT.exec(value.trim()) : null;
  if (!match) return null;
  const percent = Number(match[1]);
  return percent >= CAPTION_PERCENT.min && percent <= CAPTION_PERCENT.max ? percent : null;
}

/** True for a preset name or an exact height in range. */
export function isCaptionPosition(value) {
  return CAPTION_PRESETS.includes(value) || captionPercent(value) != null;
}

/** What a position may be, for error messages. */
export const CAPTION_POSITION_HELP =
  `${CAPTION_PRESETS.join(", ")}, or a height from ` +
  `${CAPTION_PERCENT.min}% to ${CAPTION_PERCENT.max}% (e.g. "14%": the caption's top edge that far down)`;
