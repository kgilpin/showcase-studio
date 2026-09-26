import type { CSSProperties } from "react";
import type { CaptionPosition } from "@/content/showcases";
import { captionPercent, type CaptionPreset } from "@/content/caption-position-rules.mjs";

/** Where to draw an overlay caption inside the box it sits in: a preset
 *  names a class from the view's own table; an exact height ("14%") sets
 *  the caption's top edge that far down the box. In the TikTok view the
 *  box is the whole slide. */
export function captionPlacement(
  position: CaptionPosition | undefined,
  presets: Record<CaptionPreset, string>,
): { className?: string; style?: CSSProperties } {
  const percent = captionPercent(position);
  if (percent != null) return { style: { top: `${percent}%` } };
  return { className: presets[(position as CaptionPreset | undefined) ?? "bottom"] };
}
