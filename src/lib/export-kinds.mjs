/* Export kinds, as the studio's UI names them. Shared by the page (the
 * Export button and its progress) and the shell (the system notification
 * in electron/main.mjs), so both say the same thing:
 *
 *   player view    Draft             Full quality
 *   -----------    ---------------   ------------
 *   tiktok         video-draft       video
 *   embed (4:3)    video-43-draft    video-43
 *   screens        screens (one kind — no draft)
 *
 * The player's view names are also the values showcase.yaml's meta.view
 * takes (the view a showcase opens in) and the page's ?view= parameter,
 * so they live here, next to the exports each view previews.
 */

/** The player's three views: TikTok (9:16), App Screens (the App Store
 *  canvas) and the 4:3 embed. */
export const PLAYER_VIEWS = ["tiktok", "screens", "embed"];

/** The views as the switch labels them. */
export const VIEW_LABELS = { tiktok: "TikTok", screens: "App Screens", embed: "4:3" };

/** A view name read from the outside (meta.view, a URL): one of
 *  PLAYER_VIEWS, or null for anything else. */
export function playerView(value) {
  return typeof value === "string" && PLAYER_VIEWS.includes(value) ? value : null;
}

/** What each video export renders: its frame size and frame rate. The
 *  exporter (server/exporter.mjs) renders by this table, and the Share
 *  page's time estimates count frames by it. EXPORT_FPS in the
 *  environment overrides the frame rate, for tuning. */
export const VIDEO_FORMATS = {
  video: { width: 1080, height: 1920, fps: 30 },
  "video-draft": { width: 540, height: 960, fps: 12 },
  "video-43": { width: 1440, height: 1080, fps: 30 },
  "video-43-draft": { width: 720, height: 540, fps: 12 },
};

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
