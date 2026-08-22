/* The showcase authoring guide — the domain knowledge every Claude Code
 * session in a showcases folder needs. The studio writes it into
 * <folder>/.studio/GUIDE.md on every launch (electron/main.mjs), so it
 * always matches the running app; the seeded, user-owned CLAUDE.md
 * imports it with Claude Code's @-import syntax. */

export const SHOWCASE_GUIDE = `## The data model
Each showcase is a folder: <id>/showcase.yaml (the script), optional theme.yaml (styling), assets/ (screenshots and recordings; an asset key is the file name without extension, and the full file name also works — use it when two files share a bare name), and optional graphics/ (TSX diagrams).

showcase.yaml:
- meta: title, description, loop, soundtrack {src, volume, sync?}, optional pace (narration reading speed in words/second, default 2.5). soundtrack.src may be an asset key, a root-relative path, or a URL; sync: true marks it a voiceover locked to the scene timeline (skips/loops/unmutes stay in sync) — leave unset for free-running music beds.
- scenes: a list of slides with fields: id; theme; optional title (on-screen display text ONLY — never spoken, never timed; omit it on scenes that don't display one); optional eyebrow (a label shown only on the teleprompter and script pages — never on slides); captions (the narration: list of {text, durationMs?, position? top|center|lower|bottom}); media; optional support (small supporting line, statement slides); optional cta {label, url}; export: false leaves the scene out of the App Store screenshot set (the video always includes every scene; footage scenes default out — export: true opts one back in); durationMs pins a slide's timing explicitly; transition: rise opts a slide into the rise/drift-in entrance animation (off by default so scenes cut cleanly).
- Themes are layouts, nothing more: "statement" — centered display text (claims, intros, outros; optional app-mark media above the title, full-bleed media becomes a dimmed backdrop; optional CTA); "feature" — title header over a phone-framed screenshot; "console" — title above a wide landscape media panel (desktop screenshots, TSX diagrams); "footage" — the media IS the slide, edge-to-edge with no title (on-camera segments; captions act as subtitles in the video presentation). "title" is a legacy alias for statement. A theme linter warns (diagnostics tray at the bottom of the app, and per-scene in the player and validate tool) on legacy or incoherent themes but always renders — never leave warnings unresolved.
- media: {kind: none} or {kind: image|video, asset: <key>, alt, motion? zoom-in|zoom-out|pan-up|pan-left|still, frame? phone|full|mark, fit? cover|contain, align? top|center|bottom, fadeTo? {asset, alt, align?}}. motion defaults to zoom-in for images and still for video.
- Captions are the narration, read verbatim in order — one continuous voiceover across the whole showcase; they are the ONLY spoken lines (titles never are). The player previews the export destinations as three view modes: App Screens (titles on the slide, captions in the transcript column), TikTok (captions overlaid, titles hidden), and 4:3 (the embed canvas, which composes its own captions). A caption identical to the scene's displayed title is not drawn on the slide (the title already says it) but is still narration.
- Timing derives from the copy by default: each caption prices out at its reading time (words at meta.pace plus settle and punctuation beats), and a slide is exactly long enough to speak its lines. Only pin durationMs when there is a concrete reason (e.g. syncing to a recorded voiceover).

theme.yaml (optional): whitelisted styling — colors, fonts {display, body, load: [stylesheet urls]}, shape {radius}, atmosphere {gradient-stage, gradient-accent, shadow-device}; extends: <other-showcase-id> inherits another showcase's theme.

Custom TSX diagrams: write <id>/graphics/<key>.tsx default-exporting a React component (no imports needed — JSX only; you may not import anything besides react), and reference it as media {kind: graphic, graphic: <key>, alt: ...} — usually with theme: console. Animate with CSS only (inline <style> keyframes; no JS timers) and make the resting state the fully revealed diagram; style with the theme's CSS variables (e.g. var(--card), var(--primary)). Compile or runtime errors render inside the slide, so read the slide's error and iterate until it renders.

## Working rules
- Read a file before rewriting it, and keep YAML valid — a showcase that fails to parse is shown as an error card until fixed. Referencing an asset or graphic that doesn't exist yet is fine: the slide renders a "missing asset" placeholder with a linter warning, and heals when the file lands in assets/.
- Screenshots are binary; you cannot create them. Ask the user to drop images into the showcase's assets/ folder, then reference them by key.
- Keep narration natural to read aloud, and slides focused — one idea per slide.
- This folder may be a git repository the user manages themselves — never run destructive git operations; your job is the content files.`;

/** The studio-maintained guide file, regenerated on every app launch so
 *  it always describes the running app: environment facts (paths, tools)
 *  followed by the authoring guide above. */
export function studioGuide({ version, srcDir, ffmpegPath, showcasesDir }) {
  return `<!-- Generated by Showcase Studio ${version} at every launch — do not edit;
     changes are overwritten. Your own notes belong in ../CLAUDE.md. -->

# Showcase Studio guide

This folder is a Showcase Studio library: auto-playing, video-style
product tours defined as data. The studio (a desktop app, running now)
live-reloads whenever a file here changes, so edits appear immediately.
Sessions opened by the studio start inside a specific showcase's folder —
paths are then relative to that showcase (showcase.yaml, assets/,
graphics/). The library root is ${showcasesDir}.

## The studio environment
- The studio app's complete source is at ${srcDir} (also in
  $SHOWCASE_STUDIO_SRC). Read it when you need to know exactly how
  something works: the player and slide themes
  (src/components/showcase/), the timing model (src/content/timing.mjs),
  the data pipeline (src/content/, scripts/showcase-data.mjs), exports
  (electron/exporter.mjs). Treat it as read-only reference — app changes
  belong in that repo, not in this folder.
- ffmpeg is bundled with the studio at ${ffmpegPath ?? "(unavailable)"}
  (also in $SHOWCASE_STUDIO_FFMPEG). Use it for audio and video work on
  this folder's recordings: extracting audio, cutting clips, probing
  durations, transcoding.
- Voice-to-text is built in: the transcribe MCP tool returns sentence
  segments with per-word timestamps for any recording. Use it whenever
  you need to know WHAT is said WHEN — aligning narration to scenes,
  splitting a voiceover into scene-scoped clips (transcribe, match the
  caption text to the word timestamps, cut with ffmpeg at those
  boundaries), or verifying spoken words. ffmpeg's silencedetect only
  finds pauses; prefer transcribe for anything word-aware. (The binary
  is also in $SHOWCASE_STUDIO_WHISPER when set; the speech model
  downloads once on first use.)
- The studio exposes MCP tools (server "showcase-studio", preloaded in
  studio-opened sessions; a session you start yourself gets them with
  \`claude --mcp-config .studio/mcp.json\` from the library root):
  screenshot_slide {showcaseId, sceneId} returns a rendered image of one
  slide — use it after editing a slide, theme, or TSX diagram to see your
  work; validate reports which showcases load and the error for any that
  don't — use it after YAML edits; script {showcaseId} returns the
  narration as share-ready plain text (scene headers + spoken lines).
- Exports run through the MCP export tools as background jobs: export
  {showcaseId, kind} starts one and returns a jobId immediately; poll
  export_status {jobId} while you keep working, and export_cancel stops
  it. Kinds: "video-draft" — a fast, small MP4 (12fps, half size) for
  checking your own work, use it freely while iterating; "video" — the
  full-quality 1320×2868 portrait render (TikTok), takes minutes,
  confirm with the user before starting; "video-43" / "video-43-draft" —
  the 4:3 embed canvas (1440×1080, for YouTube and desktop embeds:
  feature and footage scenes put the text beside the media);
  "screens" — the App Store screenshot set; "script" — the narration as
  plain text (instant). Output lands in ~/Downloads/showcase-exports/<id>,
  named for the showcase: <id>[_43][_draft].mp4, <id>_script.txt, and
  numbered scene PNGs. One export runs at a time. (The repo's npm export scripts only cover the showcases bundled
  in the app repo — for this folder, use the MCP tools.)

${SHOWCASE_GUIDE}
`;
}
