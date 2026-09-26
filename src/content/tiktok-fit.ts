/* TIKTOK FIT — how a scene's picture is adapted to TikTok's 9:16 frame.
 *
 * The TikTok view and the TikTok video are 1080×1920 (9:16), the shape
 * TikTok is built for. Most media isn't that shape: an iPhone screen
 * recording or App Store screenshot is 1320×2868, taller and narrower.
 * Each scene says how its picture goes into the frame:
 *
 *   fit: fill   fill the frame and crop what sticks out. `focus` picks
 *               which part stays: top, center, bottom, or a percentage
 *               that slides the kept part from the top (0%) to the
 *               bottom (100%).
 *   fit: fit    show the whole picture, smaller, with bands where it
 *               doesn't reach. `bands: blur` fills them with a blurred
 *               copy of the picture (the usual TikTok look); `bands:
 *               color` leaves the plain stage background.
 *
 *   meta:
 *     tiktok: { fit: fill, focus: 40% }     # every scene
 *   scenes:
 *     - media:
 *         kind: video
 *         asset: scene-6-spy
 *         tiktok: { fit: fit, bands: blur } # this scene only
 *
 * A scene's own `tiktok` wins field by field over meta.tiktok. What
 * neither sets comes from the media's everyday `fit` and `align`, so a
 * showcase written before this existed looks as it did: cover → fill,
 * contain → fit with plain bands, align → focus. App Screens and 4:3
 * ignore all of it.
 */

import type { MediaAlign, MediaFit, Scene } from "./showcases";
import { tiktokFieldProblem, tiktokFocus } from "./tiktok-fit-rules.mjs";

export type TikTokFitMode = "fill" | "fit";
export type TikTokBands = "blur" | "color";
export type TikTokFocus = MediaAlign | `${number}%`;

/** A resolved TikTok fit, every field filled in. */
export type TikTokFit = {
  fit: TikTokFitMode;
  /** With fill: which part of the picture stays in the frame. */
  focus: TikTokFocus;
  /** With fit: what fills the bands beside or above the picture. */
  bands: TikTokBands;
};

/** A `tiktok` map as authored, checked — any field may be missing. */
export type TikTokFitSpec = Partial<TikTokFit>;

/** The focus as a CSS object-position height: top 0%, center 50%,
 *  bottom 100%, or the authored percentage. */
export function focusPercent(focus: TikTokFocus): number {
  if (focus === "top") return 0;
  if (focus === "bottom") return 100;
  if (focus === "center") return 50;
  return Number.parseFloat(focus);
}

/** Checks an authored `tiktok` map. Unknown fields and bad values are
 *  reported through `warn` and left out, so the rest still applies. The
 *  rules are shared with the studio's edit tool (tiktok-fit-rules.mjs). */
export function readTikTokFit(
  raw: unknown,
  label: string,
  warn: (message: string) => void,
): TikTokFitSpec | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warn(`${label} must be a map like { fit: fill, focus: center } — ignoring it`);
    return undefined;
  }
  const spec: TikTokFitSpec = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const problem = tiktokFieldProblem(label, key, value);
    if (problem) warn(problem);
    else if (key === "fit") spec.fit = value as TikTokFitMode;
    else if (key === "bands") spec.bands = value as TikTokBands;
    else if (key === "focus") spec.focus = tiktokFocus(value) ?? "center";
  }
  return spec;
}

/** The fit a scene's picture gets in the TikTok frame: the scene's own
 *  spec, then the showcase's, then what the media's `fit` and `align`
 *  already say. */
export function resolveTikTokFit(
  scene: TikTokFitSpec | undefined,
  showcase: TikTokFitSpec | undefined,
  media: { fit?: MediaFit | undefined; align?: MediaAlign | undefined },
): TikTokFit {
  const fit = scene?.fit ?? showcase?.fit ?? (media.fit === "contain" ? "fit" : "fill");
  /* Bands asked for by nobody: a picture that was already `contain`
   * keeps the plain background it always had; one fitted on purpose
   * gets TikTok's usual blurred fill. */
  const bands =
    scene?.bands ??
    showcase?.bands ??
    (!scene?.fit && !showcase?.fit && media.fit === "contain" ? "color" : "blur");
  return { fit, focus: scene?.focus ?? showcase?.focus ?? media.align ?? "center", bands };
}

/** Whether a scene's TikTok fit decides how its picture fills the 9:16
 *  frame: image and video media that take up the frame — footage,
 *  feature screenshots, a statement's full-bleed backdrop. The console
 *  band, a statement's small image and the app mark keep their own
 *  layout. */
export function usesTikTokFit(scene: Scene): boolean {
  const media = scene.media;
  if (media.kind !== "image" && media.kind !== "video") return false;
  if (media.frame === "mark" || scene.theme === "console") return false;
  return scene.theme !== "statement" || media.frame === "full";
}
