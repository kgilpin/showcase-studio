/** Type declarations for caption-position-rules.mjs — see that file. */

export type CaptionPreset = "top" | "center" | "lower" | "bottom";

export const CAPTION_PRESETS: readonly CaptionPreset[];
export const CAPTION_PERCENT: { min: number; max: number };
export const CAPTION_POSITION_HELP: string;

export function captionPercent(value: unknown): number | null;
export function isCaptionPosition(value: unknown): boolean;
