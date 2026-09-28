/** Type declarations for tiktok-fit-rules.mjs — see that file. */

export const TIKTOK_FIELDS: readonly string[];
export const TIKTOK_FITS: readonly ("fill" | "fit")[];
export const TIKTOK_BANDS: readonly ("blur" | "color")[];
export const TIKTOK_FOCUS_PRESETS: readonly ("top" | "center" | "bottom")[];

export function tiktokFocus(value: unknown): "top" | "center" | "bottom" | `${number}%` | null;
export const TIKTOK_AREA_SIDES: readonly ("top" | "right" | "bottom" | "left")[];
export function tiktokArea(
  value: unknown,
): { top: number; right: number; bottom: number; left: number } | null;
export function tiktokFieldProblem(label: string, key: string, value: unknown): string | null;
