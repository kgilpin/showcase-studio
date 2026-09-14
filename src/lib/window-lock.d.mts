export type WindowLock = { kind: "showcase"; showcaseId: string } | { kind: "new" };

export function lockLandingPath(lock: WindowLock): string;

export function isCapturePage(pathname: string, search?: string): boolean;

export function isPathInLock(lock: WindowLock | null | undefined, pathname: string): boolean;
