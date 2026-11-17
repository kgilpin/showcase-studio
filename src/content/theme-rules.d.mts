/** Type declarations for theme-rules.mjs — see that file. */

export const THEME_GROUPS: Record<string, Record<string, string>>;
export const THEME_KEYS: readonly string[];
export const THEME_VARS: readonly string[];
export const THEME_SCHEMA: Record<string, unknown>;

export function themeValueProblem(key: string, value: unknown, file?: string): string | null;
export function cleanTheme(
  doc: unknown,
  file?: string,
): { theme: Record<string, unknown>; problems: string[] };
