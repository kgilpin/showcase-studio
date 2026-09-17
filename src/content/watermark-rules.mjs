/* The brand mark's fixed rules — its fields, the corners it may sit in,
 * and the ranges its numbers take. Plain ESM with no imports, like
 * timing.mjs, so the loader (src/content/watermark.ts) and the studio's
 * edit tool (server/edit-yaml.mjs) read one copy. Types live in
 * watermark-rules.d.mts; the model is documented in watermark.ts. */

export const WATERMARK_FIELDS = ["asset", "text", "position", "opacity", "scale"];

/** A corner — never a banner. */
export const WATERMARK_POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"];

export const WATERMARK_OPACITY = { min: 0, max: 1 };
export const WATERMARK_SCALE = { min: 0.25, max: 3 };

export const WATERMARK_DEFAULTS = { position: "top-left", opacity: 0.85, scale: 1 };

/** True when `value` is a number inside `range`, ends included. */
export function inRange(value, range) {
  return (
    typeof value === "number" && Number.isFinite(value) && value >= range.min && value <= range.max
  );
}
