/* Window locks: a studio window launched with --open or --new
 * (server/launch-options.mjs) is pinned — to one showcase, or to the New
 * Showcase page until it creates one — and must not switch showcases.
 * Shared by the shell, which enforces the lock (electron/main.mjs), and
 * the page, which hides switching controls and redirects, so both agree
 * on what is inside the lock:
 *
 *   { kind: "showcase", showcaseId }   /showcase/<id> and every page under it
 *   { kind: "new" }                    /new only
 */

/** The page a locked window belongs on. */
export function lockLandingPath(lock) {
  return lock.kind === "new" ? "/new" : `/showcase/${encodeURIComponent(lock.showcaseId)}`;
}

/** Whether a pathname is inside the lock. With no lock, every path is. */
export function isPathInLock(lock, pathname) {
  if (!lock) return true;
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  if (lock.kind === "new") return trimmed === "/new";
  const match = /^\/showcase\/([^/]+)(?:\/|$)/.exec(trimmed);
  if (!match) return false;
  try {
    return decodeURIComponent(match[1]) === lock.showcaseId;
  } catch {
    return false;
  }
}
