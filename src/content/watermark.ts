/* WATERMARK — the persistent brand mark ("bug") in a corner of every
 * slide, the way a TV network's logo sits in the corner of a broadcast.
 *
 * `meta.watermark` in showcase.yaml turns it on for the whole showcase;
 * a scene's own `watermark` overrides it — `false` opts that slide out,
 * a map changes a field or two for that slide, `true` forces the bug on
 * where the default would have dropped it.
 *
 *   meta:
 *     watermark:
 *       asset: my-brand-mark     # asset key, root-relative path, or URL
 *       text: My Brand           # optional wordmark beside the mark
 *       position: top-left       # a corner — never a banner
 *       opacity: 0.85
 *       scale: 1
 *
 * Two deliberate limits:
 *
 *  - The bug goes in a CORNER. Branded editorial video puts it there;
 *    a full-width band across the frame reads as an ad and fights the
 *    captions and the speaker's face. There is no banner position.
 *  - The bug is an IDENTITY mark — a logo, a wordmark. The App Store
 *    badge is a call to action, with clear-space and minimum-size rules
 *    a small persistent copy would break; it belongs on the end card,
 *    which is what a scene's `cta` field is for.
 *
 * The default position is a top corner because the bottom of the frame
 * belongs to the captions (and, in the video export, to the platform's
 * own UI). The default opacity is just under solid: the mark has to hold
 * up over busy footage, and its small corner size is what keeps it
 * reading as authorship rather than advertising.
 */

const POSITIONS = ["top-left", "top-right", "bottom-left", "bottom-right"] as const;

export type WatermarkPosition = (typeof POSITIONS)[number];

/** A validated watermark, every field filled in. */
export type WatermarkSpec = {
  /** Asset key, root-relative path, or URL of the mark image, as authored. */
  asset?: string | undefined;
  /** Wordmark drawn beside the image (or on its own, with no image). */
  text?: string | undefined;
  position: WatermarkPosition;
  /** 0–1. Just under solid by default, so it survives busy footage. */
  opacity: number;
  /** Size multiplier on the canvas's own bug size. */
  scale: number;
};

/** A watermark ready to draw: the mark image resolved to a served URL. */
export type Watermark = WatermarkSpec & {
  /** The mark image's URL; absent for a text-only bug. */
  src?: string | undefined;
  /** The resolved file, for the assets page's usage list. */
  file?: string | undefined;
};

export const WATERMARK_DEFAULTS = {
  position: "top-left" as WatermarkPosition,
  opacity: 0.85,
  scale: 1,
};

const FIELDS = ["asset", "text", "position", "opacity", "scale"];

/** Validates one authored `watermark` map and returns just the fields it
 *  set, so a scene's map can be merged over the showcase's. Anything
 *  invalid warns and is left out — a bad value never breaks a slide. */
export function readWatermark(
  authored: unknown,
  where: string,
  warn: (message: string) => void,
): Partial<WatermarkSpec> | undefined {
  if (authored == null) return undefined;
  if (typeof authored !== "object" || Array.isArray(authored)) {
    warn(`${where} must be a map of ${FIELDS.join(", ")} — ignoring it`);
    return undefined;
  }
  const raw = authored as Record<string, unknown>;
  const spec: Partial<WatermarkSpec> = {};
  for (const key of Object.keys(raw)) {
    if (!FIELDS.includes(key)) {
      warn(`${where} has no "${key}" field — it takes: ${FIELDS.join(", ")}`);
    }
  }
  if (raw["asset"] != null) {
    if (typeof raw["asset"] === "string" && raw["asset"].trim()) spec.asset = raw["asset"].trim();
    else warn(`${where}.asset must be an asset key, a root-relative path, or a URL`);
  }
  if (raw["text"] != null) {
    if (typeof raw["text"] === "string" || typeof raw["text"] === "number") {
      spec.text = String(raw["text"]).trim();
    } else warn(`${where}.text must be the wordmark to draw beside the image`);
  }
  if (raw["position"] != null) {
    if (POSITIONS.includes(raw["position"] as WatermarkPosition)) {
      spec.position = raw["position"] as WatermarkPosition;
    } else {
      warn(
        `${where}.position must be a corner: ${POSITIONS.join(", ")} — ` +
          `using "${WATERMARK_DEFAULTS.position}"`,
      );
    }
  }
  if (raw["opacity"] != null) {
    const opacity = Number(raw["opacity"]);
    if (Number.isFinite(opacity) && opacity >= 0 && opacity <= 1) spec.opacity = opacity;
    else warn(`${where}.opacity must be between 0 and 1 — using ${WATERMARK_DEFAULTS.opacity}`);
  }
  if (raw["scale"] != null) {
    const scale = Number(raw["scale"]);
    if (Number.isFinite(scale) && scale >= 0.25 && scale <= 3) spec.scale = scale;
    else warn(`${where}.scale must be between 0.25 and 3 — using ${WATERMARK_DEFAULTS.scale}`);
  }
  return spec;
}

/** The bug for one scene: the showcase's setting, the scene's override,
 *  and the one default — a statement slide whose media IS the mark shows
 *  the logo full size already, so it doesn't also carry the small copy.
 *  `watermark: true` on such a scene puts it back. */
export function resolveWatermark(
  base: Partial<WatermarkSpec> | undefined,
  authored: unknown,
  { sceneShowsMark = false }: { sceneShowsMark?: boolean },
  warn: (message: string) => void,
): WatermarkSpec | undefined {
  let override: Partial<WatermarkSpec> | undefined;
  let forced = false;
  if (authored === false) return undefined;
  else if (authored === true) forced = true;
  else if (authored != null && typeof authored === "object") {
    override = readWatermark(authored, "scene watermark", warn);
    forced = true;
  } else if (authored != null) {
    warn(`scene watermark must be false, true, or a map — ignoring "${String(authored)}"`);
  }
  if (!forced && sceneShowsMark) return undefined;
  const merged = { ...base, ...override };
  if (!merged.asset && !merged.text) {
    if (forced && (base || override)) {
      warn(`a watermark needs an asset, a text wordmark, or both — nothing to draw`);
    }
    return undefined;
  }
  return {
    ...(merged.asset ? { asset: merged.asset } : {}),
    ...(merged.text ? { text: merged.text } : {}),
    position: merged.position ?? WATERMARK_DEFAULTS.position,
    opacity: merged.opacity ?? WATERMARK_DEFAULTS.opacity,
    scale: merged.scale ?? WATERMARK_DEFAULTS.scale,
  };
}
