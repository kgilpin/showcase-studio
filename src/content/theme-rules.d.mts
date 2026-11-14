/** Type declarations for theme-rules.mjs — see that file. */

export const THEME_GROUPS: Record<string, Record<string, string>>;
export const THEME_KEYS: readonly string[];

export function themeValueProblem(key: string, value: unknown, file?: string): string | null;
export function themeDocProblem(doc: Record<string, unknown>, file?: string): string | null;
