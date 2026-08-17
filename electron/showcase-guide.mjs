/* The showcase authoring guide — the domain knowledge shared by both
 * agent surfaces: the BYOK panel's system prompt (electron/agent.mjs)
 * and the CLAUDE.md seeded into the user's showcases folder so Claude
 * Code sessions load it automatically (electron/main.mjs). */

export const SHOWCASE_GUIDE = `## The data model
Each showcase is a folder: <id>/showcase.yaml (the script), optional theme.yaml (styling), assets/ (screenshots; asset keys are file names without extension), and optional graphics/ (TSX diagrams).

showcase.yaml:
- meta: title, description, loop, soundtrack {src, volume}, optional pace (narration reading speed in words/second, default 2.5).
- scenes: a list of slides with fields: id; theme; title; optional eyebrow (a label shown only on the teleprompter and script pages — never on slides); captions (list of {text, durationMs?, position? top|center|lower|bottom}); media; optional support (small supporting line, statement slides); optional cta {label, url}; export: false leaves the scene out of the App Store screenshot set (the video always includes every scene); durationMs / titleDurationMs pin timing explicitly.
- Themes: "title" — a full-screen text slide whose title IS spoken narration (on-camera beats, intros, outros); "feature" — title over a phone screenshot, the title is on-screen text only; "statement" — centered text slide; "console" — wide landscape media panel.
- media: {kind: none} or {kind: image|video, asset: <key>, alt, motion? zoom-in|zoom-out|pan-up|pan-left|still, frame? phone|full|mark, fit? cover|contain, align? top|center|bottom, fadeTo? {asset, alt, align?}}.
- Captions are the narration, read verbatim in order — one continuous voiceover across the whole showcase. There are two presentations: App Screens (slide titles shown, captions off the media) and video (captions overlaid, feature titles hidden).
- Timing derives from the copy by default: each caption prices out at its reading time (words at meta.pace plus settle and punctuation beats), spoken titles own the start of title slides, and a slide is exactly long enough to speak its lines. Only pin durationMs when there is a concrete reason (e.g. syncing to music).

theme.yaml (optional): whitelisted styling — colors, fonts {display, body, load: [stylesheet urls]}, shape {radius}, atmosphere {gradient-stage, gradient-accent, shadow-device}; extends: <other-showcase-id> inherits another showcase's theme.

Custom TSX diagrams: write <id>/graphics/<key>.tsx default-exporting a React component (no imports needed — JSX only; you may not import anything besides react), and reference it as media {kind: graphic, graphic: <key>, alt: ...} — usually with theme: console. Animate with CSS only (inline <style> keyframes; no JS timers) and make the resting state the fully revealed diagram; style with the theme's CSS variables (e.g. var(--card), var(--primary)). Compile or runtime errors render inside the slide, so read the slide's error and iterate until it renders.

## Working rules
- Read a file before rewriting it, and keep YAML valid — a parse error breaks the app until fixed.
- Screenshots are binary; you cannot create them. Ask the user to drop images into the showcase's assets/ folder, then reference them by key.
- Keep narration natural to read aloud, and slides focused — one idea per slide.
- This folder may be a git repository the user manages themselves — never run destructive git operations; your job is the content files.`;
