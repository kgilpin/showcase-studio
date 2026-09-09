/* The showcase authoring guide — the domain knowledge every Claude Code
 * session in a showcases folder needs. The studio writes it into
 * <folder>/.studio/GUIDE.md on every launch (electron/main.mjs), so it
 * always matches the running app; the seeded, user-owned CLAUDE.md
 * imports it with Claude Code's @-import syntax. */

export const SHOWCASE_GUIDE = `## The data model
Each showcase is a folder: <id>/showcase.yaml (the script), optional theme.yaml (styling), assets/ (screenshots and recordings; an asset key is the file name without extension, and the full file name also works — use it when two files share a bare name), and optional graphics/ (TSX diagrams).

showcase.yaml:
- meta: title, description, loop, soundtrack {src, volume, sync?}, optional pace (narration reading speed in words/second, default 2.5). soundtrack.src may be an asset key, a root-relative path, or a URL; sync: true marks it a voiceover locked to the scene timeline (skips/loops/unmutes stay in sync) — leave unset for free-running music beds.
- scenes: a list of slides with fields: id; theme; optional title (on-screen display text ONLY — never spoken, never timed; omit it on scenes that don't display one); optional eyebrow (a label shown only on the teleprompter and script pages — never on slides); captions (the narration: list of {text, durationMs?, position? top|center|lower|bottom}); optional captionStyle (chip | karaoke | reveal — worded styles paint overlay captions word by word, paced by the reading model, or exactly synced when assets/<soundtrack-src>.words.json holds the transcribe tool's word timestamps; meta.captionStyle sets it showcase-wide). Caption colors are themeable in theme.yaml: colors.caption-chip / caption-text / caption-word, and atmosphere.gradient-stage is the slide background; media; optional support (small supporting line, statement slides); optional cta {label, url, kind?} plus ctaNote (a small note line under the button) — kind defaults to app-store, which draws the App Store badge; kind: github draws a "View on GitHub" badge with GitHub's mark; kind: link draws a labeled pill button for any other destination — every theme renders them: statement centers them under the text, the stacked layouts pin them below the media; export: false leaves the scene out of the App Store screenshot set (the video always includes every scene; footage scenes default out — export: true opts one back in); durationMs pins a slide's timing explicitly; transition: rise opts a slide into the rise/drift-in entrance animation (off by default so scenes cut cleanly).
- Themes are layouts, nothing more: "statement" — centered display text (claims, intros, outros; optional app-mark media above the title, full-bleed media becomes a dimmed backdrop; optional CTA); "feature" — title header over a phone-framed screenshot; "console" — title above a wide landscape media panel (desktop screenshots, TSX diagrams); "footage" — the media IS the slide, edge-to-edge with no title (on-camera segments; captions act as subtitles in the video presentation). "title" is a legacy alias for statement. A theme linter warns (diagnostics tray at the bottom of the app, and per-scene in the player and validate tool) on legacy or incoherent themes but always renders — never leave warnings unresolved.
- media: {kind: none} or {kind: image|video, asset: <key>, alt, motion? zoom-in|zoom-out|pan-up|pan-left|still, frame? phone|full|mark, fit? cover|contain, align? top|center|bottom, fadeTo? {asset, alt, align?}}. motion defaults to zoom-in for images and still for video. fadeTo works on image media only — a video never fades to a still.
- Captions are the narration, read verbatim in order — one continuous voiceover across the whole showcase; they are the ONLY spoken lines (titles never are). The player previews the export destinations as three view modes: App Screens (titles on the slide, captions in the transcript column), TikTok (captions overlaid, titles hidden), and 4:3 (the embed canvas, which composes its own captions). A caption identical to the scene's displayed title is not drawn on the slide (the title already says it) but is still narration.
- Timing derives from the copy by default: each caption prices out at its reading time (words at meta.pace plus settle and punctuation beats), and a slide is exactly long enough to speak its lines. Only pin durationMs when there is a concrete reason (e.g. syncing to a recorded voiceover).

theme.yaml (optional): whitelisted styling — colors, fonts {display, body, load: [stylesheet urls]}, shape {radius}, atmosphere {gradient-stage, gradient-accent, shadow-device}; extends: <other-showcase-id> inherits another showcase's theme.

Custom TSX diagrams: write <id>/graphics/<key>.tsx default-exporting a React component (no imports needed — JSX only; you may not import anything besides react), and reference it as media {kind: graphic, graphic: <key>, alt: ...} — usually with theme: console. Animate with CSS only (inline <style> keyframes; no JS timers) and make the resting state the fully revealed diagram; style with the theme's CSS variables (e.g. var(--card), var(--primary)). Compile or runtime errors render inside the slide, so read the slide's error and iterate until it renders.

## Recorded pitches (on-camera footage)
A talking-head recording (a phone selfie video) becomes a showcase like this — the pieces above don't assemble themselves, so follow the recipe:
- Footage video always plays muted (in the player and in every export). The voice must come from meta.soundtrack: extract the audio with ffmpeg to assets/voiceover.m4a and set soundtrack: {src: voiceover, volume: 1.0, sync: true}.
- Transcribe the ORIGINAL recording once and work from that single transcript for everything — cut points, captions, and the words file. Re-transcribing audio you've already cut can mishear words the full recording got right; when the timeline starts later than the recording (a trimmed false start), subtract the trim offset from the timestamps instead.
- One footage scene per idea, each with its own silent clip. Choose cut points at sentence boundaries from the word timestamps, and cut with ffmpeg, re-encoding for frame-accurate cuts (-c:v libx264 -an; a phone's rotation metadata is applied automatically). Name the clips scene-N-<idea>.mp4.
- The portrait stage is 1320×2868 (aspect ≈ 0.46) — narrower than a 9:16 phone clip, so the default fit: cover crops about 18% of the clip's width. To letterbox instead with ~10% bands top and bottom, crop the clip to the stage width over 80% of the stage height (1320:2294 ≈ 0.575 — a 1080×1920 clip crops to 1080×1878) and set fit: contain; the speaker's size on screen doesn't change, cover just trades the width loss for the bands.
- Pin each scene's durationMs to its clip's length, and make the durations add up to the voiceover's length. The synced soundtrack follows the scene timeline, so any gap between the two shows up as lips out of sync.
- Each scene's caption is the clip's spoken sentence, lightly copy-edited (punctuation, casing, product names). Save the original recording's transcript, timestamps shifted by any trim offset so time zero is the voiceover's first sample, as assets/<soundtrack-src>.words.json (e.g. voiceover.words.json) and set captionStyle: karaoke or reveal for word-by-word captions synced to the real voice. Words are matched in order, ignoring case and punctuation; a caption word that doesn't match (a misheard word, "long-lasting" vs "long - lasting", a URL) interpolates between its matched neighbours, and a caption falls back to synthetic pacing if fewer than half its words match — so keep the caption's word order as spoken, and fix a misheard word in the .words.json text rather than bending the caption to it.
- To drop a false start ("Hello everybody…"), cut the clips and the voiceover from the same point so the timeline starts at zero on the first kept word.
- For a silent scene after the speaker finishes (an end card with the CTA, say), pad the voiceover with trailing silence (ffmpeg -af apad) so the scene durations still sum to the audio length. A scene with pinned durationMs may have captions: [].
- Footage scenes are left out of the App Store screenshot set by default; add statement or feature scenes if the showcase also needs screenshots.

## Working rules
- Read a file before rewriting it, and keep YAML valid — a showcase that fails to parse is shown as an error card until fixed. Referencing an asset or graphic that doesn't exist yet is fine: the slide renders a "missing asset" placeholder with a linter warning, and heals when the file lands in assets/.
- Screenshots are binary; you cannot create them. Ask the user to drop images into the showcase's assets/ folder, then reference them by key.
- Keep narration natural to read aloud, and slides focused — one idea per slide.
- This folder may be a git repository the user manages themselves — never run destructive git operations; your job is the content files.`;

/** True when a user-owned CLAUDE.md still carries an inline copy of the
 *  data model from a pre-split seed — those copies drift from the app
 *  and contradict the generated guide. */
export function hasStaleInlineGuide(claudeMd) {
  return claudeMd.includes("## The data model");
}

/** The studio-maintained guide file, regenerated on every app launch so
 *  it always describes the running app: environment facts (paths, tools)
 *  followed by the authoring guide above. */
export function studioGuide({ version, srcDir, ffmpegPath, showcasesDir, staleClaudeMd }) {
  return `<!-- Generated by Showcase Studio ${version} at every launch — do not edit;
     changes are overwritten. Your own notes belong in ../CLAUDE.md. -->

# Showcase Studio guide

This folder is a Showcase Studio library: auto-playing, video-style
product tours defined as data. The studio (a desktop app, running now)
live-reloads whenever a file here changes, so edits appear immediately.
Sessions opened by the studio start inside a specific showcase's folder —
paths are then relative to that showcase (showcase.yaml, assets/,
graphics/). The library root is ${showcasesDir}.
${
  staleClaudeMd
    ? `
> WARNING: this library's CLAUDE.md still contains an outdated inline
> copy of the studio's instructions (a "## The data model" section from
> an old seed), and parts of it contradict this guide — for example it
> may claim slide titles are spoken. THIS guide is generated by the
> running app and wins every conflict. Suggest to the user cutting
> CLAUDE.md down to the @.studio/GUIDE.md import plus notes specific to
> this library.
`
    : ""
}

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
