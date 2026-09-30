/* Small text helpers for the Share page: a video's length and size, and
 * how long ago something happened. */

/** "0:42", "12:05". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** "14 MB", "820 KB". */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** "just now", "5 min ago", "3 h ago", then the date ("29 Sep"). */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.round((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return then.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** An export's expected time, rounded the way people say it: "about a
 *  minute", "about 4 minutes", "about 1 hour 10 minutes". */
export function formatEstimate(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes === 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `about ${hours} hour${hours > 1 ? "s" : ""}${rest ? ` ${rest} minutes` : ""}`;
}

/** Hashtags as the page shows them: "#iphone #techtok". */
export function hashtagText(tags: string[]): string {
  return tags.map((tag) => `#${tag}`).join(" ");
}
