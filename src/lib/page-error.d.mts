export type PageError = { message: string; stack: string; path: string; at: string };

export function summarizeError(error: unknown): { message: string; stack: string };

export function recordPageError(
  error: unknown,
  options?: { path?: string; at?: Date | string | number },
): PageError;

export function clearPageError(): void;

export function currentPageError(): PageError | null;

export function pageErrorField(): { pageError?: PageError };

export function pageLoadFailureMessage(fallback: string, pageError?: PageError | null): string;

export function registerStudio(): () => void;

export function mayShowErrorDetails(request: Request): boolean;
