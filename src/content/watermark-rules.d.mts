/** Type declarations for watermark-rules.mjs — see that file. */

export type WatermarkPosition = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const WATERMARK_FIELDS: readonly string[];
export const WATERMARK_POSITIONS: readonly WatermarkPosition[];
export const WATERMARK_OPACITY: { min: number; max: number };
export const WATERMARK_SCALE: { min: number; max: number };
export const WATERMARK_INSET: { min: number; max: number };
export const WATERMARK_SHADE: { min: number; max: number };
export const WATERMARK_SHADE_ON: number;
export const WATERMARK_DEFAULTS: { position: WatermarkPosition; opacity: number; scale: number };

export function inRange(value: unknown, range: { min: number; max: number }): value is number;
export function watermarkInset(value: unknown): number | null;
export function watermarkShade(value: unknown): number | null;
