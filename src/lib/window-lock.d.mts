export type WindowLock = { kind: "showcase"; showcaseId: string } | { kind: "new" };

export function lockLandingPath(lock: WindowLock): string;

export function isPathInLock(lock: WindowLock | null | undefined, pathname: string): boolean;
