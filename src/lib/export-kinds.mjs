/* Export kinds, as the studio's UI names them. Shared by the page (the
 * Export button and its progress) and the shell (the system notification
 * in electron/main.mjs), so both say the same thing:
 *
 *   player view    Draft             Full quality
 *   -----------    ---------------   ------------
 *   tiktok         video-draft       video
 *   embed (4:3)    video-43-draft    video-43
 *   screens        screens (one kind — no draft)
 */

/** The export the player's current view previews. */
export function exportKindFor(view, quality) {
  if (view === "screens") return "screens";
  const base = view === "embed" ? "video-43" : "video";
  return quality === "draft" ? `${base}-draft` : base;
}

const LABELS = {
  screens: "Screenshots",
  script: "Script",
  video: "TikTok video",
  "video-draft": "TikTok draft",
  "video-43": "4:3 video",
  "video-43-draft": "4:3 draft",
};

/** A short name for an export kind: "4:3 draft", "Screenshots". */
export function exportLabel(kind) {
  return LABELS[kind] ?? kind;
}

/** How far along a job is, 0–100, or null while there is nothing to
 *  count (starting, encoding). */
export function exportPercent(job) {
  if (!job.steps || job.step == null) return null;
  return Math.max(0, Math.min(100, Math.round((job.step / job.steps) * 100)));
}

/** What the file manager is called, for "Show in Finder" — from
 *  navigator.platform ("MacIntel") or process.platform ("darwin"). */
export function fileManagerName(platform) {
  if (/^(darwin|mac)/i.test(platform)) return "Finder";
  if (/^win/i.test(platform)) return "Explorer";
  return "folder";
}
