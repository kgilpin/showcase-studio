/* What a `tiktok` fit may say. Plain ESM with no imports, like
 * caption-position-rules.mjs, so the loader (src/content/tiktok-fit.ts)
 * and the studio's edit tool (server/edit-yaml.mjs) read one copy.
 * Types live in tiktok-fit-rules.d.mts; the model is in tiktok-fit.ts. */

export const TIKTOK_FIELDS = ["fit", "focus", "bands"];
export const TIKTOK_FITS = ["fill", "fit"];
export const TIKTOK_BANDS = ["blur", "color"];
export const TIKTOK_FOCUS_PRESETS = ["top", "center", "bottom"];

const PERCENT = /^(\d+(?:\.\d+)?)%$/;

/** The focus as written ("top", "40%"), or null when `value` isn't one.
 *  A percentage runs from 0% (keep the top) to 100% (keep the bottom). */
export function tiktokFocus(value) {
  if (TIKTOK_FOCUS_PRESETS.includes(value)) return value;
  const match = typeof value === "string" ? PERCENT.exec(value.trim()) : null;
  return match && Number(match[1]) <= 100 ? `${Number(match[1])}%` : null;
}

/** What is wrong with one field of a `tiktok` map, or null when it's fine. */
export function tiktokFieldProblem(label, key, value) {
  if (key === "fit") {
    return TIKTOK_FITS.includes(value)
      ? null
      : `${label}.fit "${value}" isn't a fit — use fill or fit`;
  }
  if (key === "focus") {
    return tiktokFocus(value) != null
      ? null
      : `${label}.focus "${value}" isn't a focus — use top, center, bottom, or a percentage like 40%`;
  }
  if (key === "bands") {
    return TIKTOK_BANDS.includes(value)
      ? null
      : `${label}.bands "${value}" isn't a band style — use blur or color`;
  }
  return `${label} has no field "${key}" — its fields are ${TIKTOK_FIELDS.join(", ")}`;
}
