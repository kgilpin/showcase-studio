/** Type declarations for caption-starts-rules.mjs — see that file. */

export const CAPTION_ID_PATTERN: string;
export const CAPTION_ID_HELP: string;
export function isCaptionId(value: unknown): value is string;
export function captionStartVariable(id: string): string;
export function captionStartStyle(scene: {
  durationMs: number;
  captions: { id?: string; text: string; durationMs?: number }[];
}): Record<string, string>;
export function captionIdProblems(captions: { id?: unknown }[]): string[];
export function captionStartsUsed(source: string): string[];
export function missingCaptionStarts(options: {
  graphic: string;
  source: string;
  captions: { id?: unknown }[];
}): string[];
