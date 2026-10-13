/* The brand mark's fixed rules — its fields, the corners it may sit in,
 * and the ranges its numbers take. Plain ESM with no imports, like
 * timing.mjs, so the loader (src/content/watermark.ts) and the studio's
 * edit tool (server/edit-yaml.mjs) read one copy. Types live in
 * watermark-rules.d.mts; the model is documented in watermark.ts. */

export const WATERMARK_FIELDS = ["asset", "text", "position", "inset", "shade", "opacity", "scale"];

/** A corner — never a banner. */
export const WATERMARK_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export const WATERMARK_OPACITY = { min: 0, max: 1 };
export const WATERMARK_SCALE = { min: 0.25, max: 3 };

/** How far down (top corners) or up (bottom corners) a mark may be pushed
 *  from the frame's edge, in percent of the frame's height — to clear a
 *  platform's own interface (TikTok covers about the top 13%). */
export const WATERMARK_INSET = { min: 0, max: 50 };
/** The opacity of the dark panel drawn behind the mark. */
export const WATERMARK_SHADE = { min: 0, max: 1 };
/** The shade's opacity when it is simply turned on (shade: true). */
export const WATERMARK_SHADE_ON = 0.45;

export const WATERMARK_DEFAULTS = { position: "top-left", opacity: 0.85, scale: 1 };

/** True when `value` is a number inside `range`, ends included. */
export function inRange(value, range) {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max
  );
}

const PERCENT = /^(\d+(?:\.\d+)?)%$/;

/** The percent of an authored inset ("13%" → 13), or null when `value`
 *  isn't a percent inside WATERMARK_INSET. */
export function watermarkInset(value) {
  const match = typeof value === "string" ? PERCENT.exec(value.trim()) : null;
  if (!match) return null;
  const percent = Number(match[1]);
  return inRange(percent, WATERMARK_INSET) ? percent : null;
}

/** The shade's opacity for an authored value: true turns it on at
 *  WATERMARK_SHADE_ON, false turns it off (0), a number in range is the
 *  opacity itself. null when `value` is none of those. */
export function watermarkShade(value) {
  if (value === true) return WATERMARK_SHADE_ON;
  if (value === false) return 0;
  return inRange(value, WATERMARK_SHADE) ? value : null;
}
