/* The showcase authoring guide — the domain knowledge every Claude Code
 * session in a showcases folder needs. The studio writes it into
 * <folder>/.studio/GUIDE.md on every launch (electron/main.mjs), so it
 * always matches the running app; the seeded, user-owned CLAUDE.md
 * imports it with Claude Code's @-import syntax. */

export const SHOWCASE_GUIDE = `## The data model
Each showcase is a folder: <id>/showcase.yaml (the script), optional theme.yaml (styling), assets/ (screenshots and recordings; an asset key is the file name without extension, and the full file name also works — use it when two files share a bare name), and optional graphics/ (TSX diagrams).

showcase.yaml:
- meta: title, description, loop, optional soundtrack {src, volume, sync?}, optional notes (showcase-level authoring notes — shown on the script page, never rendered in the player or exports), optional pace (narration reading speed in words/second, default 2.5). soundtrack.src may be an asset key, a root-relative path, or a URL; sync: true marks it a voiceover locked to the scene timeline (skips/loops/unmutes stay in sync) — leave unset for free-running music beds. Optional embedCaptions (true | false) decides whether the 4:3 embed lays captions over the media on console slides; leave it unset to follow the voiceover: hidden when a synced soundtrack is set (the voice already carries the narration), shown otherwise. The player's 4:3 captions toggle writes it; its reset removes it.
- scenes: a list of slides with fields: id; theme; optional title (on-screen display text ONLY — never spoken, never timed; omit it on scenes that don't display one); optional eyebrow (a label shown only on the teleprompter and script pages — never on slides); optional note (the scene's authoring note — what a take is, what's still pending; script page only, never rendered); captions (the narration: list of {text, durationMs?, position? top|center|lower|bottom}); optional captionStyle (chip | karaoke | reveal — worded styles paint overlay captions word by word, paced by the reading model, or exactly synced when assets/<soundtrack-src>.words.json holds the transcribe tool's word timestamps; meta.captionStyle sets it showcase-wide). Caption colors are themeable in theme.yaml: colors.caption-chip / caption-text / caption-word, and atmosphere.gradient-stage is the slide background; media; optional support (small supporting line, statement slides); optional cta {label, url, kind?} plus ctaNote (a small note line under the button) — kind defaults to app-store, which draws the App Store badge; kind: github draws a "View on GitHub" badge with GitHub's mark; kind: link draws a labeled pill button for any other destination — every theme renders them: statement centers them under the text, the stacked layouts pin them below the media; export: false leaves the scene out of the App Store screenshot set (the video always includes every scene; footage scenes default out — export: true opts one back in); durationMs pins a slide's timing explicitly (on a showcase cut from a recording, the build writes it — see "Recorded pitches" — so don't set it by hand there); take names the span of the master recording the scene owns, on those showcases only; transition: rise opts a slide into the rise/drift-in entrance animation (off by default so scenes cut cleanly).
- Themes are layouts, nothing more: "statement" — centered display text (claims, intros, outros; optional app-mark media above the title, full-bleed media becomes a dimmed backdrop; optional CTA); "feature" — title header over a phone-framed screenshot; "console" — title above a wide landscape media panel (desktop screenshots, TSX diagrams); "footage" — the media IS the slide, edge-to-edge with no title (on-camera segments; captions act as subtitles in the video presentation). "title" is a legacy alias for statement. A theme linter warns (diagnostics tray at the bottom of the app, and per-scene in the player and validate tool) on legacy or incoherent themes but always renders — never leave warnings unresolved.
- media: {kind: none} or {kind: image|video, asset: <key>, alt, motion? zoom-in|zoom-out|pan-up|pan-left|still, frame? phone|full|mark, fit? cover|contain, align? top|center|bottom, fadeTo? {asset, alt, align?}}. motion defaults to zoom-in for images and still for video. fadeTo works on image media only — a video never fades to a still.
- Captions are the narration, read verbatim in order — one continuous voiceover across the whole showcase; they are the ONLY spoken lines (titles never are). The player previews the export destinations as three view modes: App Screens (titles on the slide, captions in the transcript column), TikTok (captions overlaid, titles hidden), and 4:3 (the embed canvas, which composes its own captions — console slides overlay them on the media unless meta.embedCaptions turns that off, which a synced voiceover does by default). A caption identical to the scene's displayed title is not drawn on the slide (the title already says it) but is still narration.
- Timing derives from the copy by default: each caption prices out at its reading time (words at meta.pace plus settle and punctuation beats), and a slide is exactly long enough to speak its lines. Only pin durationMs when there is a concrete reason — and on a showcase cut from a recording, never by hand: its take decides, and build_media writes the pin.

theme.yaml (optional): whitelisted styling — colors, fonts {display, body, load: [stylesheet urls]}, shape {radius}, atmosphere {gradient-stage, gradient-accent, shadow-device}; extends: <other-showcase-id> inherits another showcase's theme. Put quotes around any value that contains a # (a hex color, a gradient): in YAML a space followed by # starts a comment, so an unquoted "linear-gradient(100deg, #34e7d6, #0a8f95)" is silently cut to "linear-gradient(100deg," and the browser drops it.

Custom TSX diagrams: write <id>/graphics/<key>.tsx default-exporting a React component (no imports needed — JSX only; you may not import anything besides react), and reference it as media {kind: graphic, graphic: <key>, alt: ...} — usually with theme: console. Animate with CSS only (inline <style> keyframes; no JS timers) and make the resting state the fully revealed diagram; style with the theme's CSS variables (e.g. var(--card), var(--primary)). Compile or runtime errors render inside the slide, so read the slide's error and iterate until it renders.

## Recorded pitches (on-camera footage)
A talking-head recording — a phone selfie video, an interview — becomes a showcase by naming the recording once and giving each scene the span of it that scene owns. The studio builds everything else. Never cut clips, join a voiceover, or work out durationMs by hand or with a script: they all come from the same list, which is the only reason the picture and the voice stay together.

    meta:
      source:
        video: Interview.MOV      # the master recording, in assets/
        speed: 1.1                # applied to picture and sound (0.5-2)
    scenes:
      - id: pankuri-intro
        theme: footage
        take: {from: 28.300, to: 35.600}   # seconds in the recording

Then run build_media (or press "Build media" in the studio). It writes:
- assets/<voiceover>.mp3 — every scene's audio spans joined in order and retimed, which is the showcase's voice. It is set as meta.soundtrack {sync: true} on the first build.
- assets/clip-<scene>.mp4 — one muted clip per footage scene, cut frame-accurately.
- assets/<voiceover>.words.json — the recording's transcript remapped onto this cut, for karaoke and reveal captions.
- durationMs on every scene, written into showcase.yaml for you.

Three kinds of scene, so every scene must have a take:
- take: {from, to} on a footage scene — a clip is cut and its sound is kept.
- The same take on any other theme — the scene shows its own screenshot or diagram while the voice keeps talking. (clip: true / clip: false overrides the default either way; a footage scene that shows the app mark instead of a clip needs clip: false.)
- take: {silence: 5.0} — a card with nothing spoken over it. The voiceover gets that much silence, so the timeline still lines up.

A scene can keep more than one span, which is how a pause or a fluffed sentence is dropped: take: [{from: 0, to: 5.53}, {from: 5.88, to: 10.16}]. When the picture should fast-forward through a pause instead of cutting to a jump, give the sides their own spans and squeeze the pause with fit — the seconds it plays in:

    take:
      audio: [{from: 0, to: 5.53}, {from: 5.88, to: 10.16}]
      video: [{from: 0, to: 5.31}, {from: 5.31, to: 6.10, fit: 0.44},
              {from: 6.10, to: 10.16}]

The two sides must last exactly the same, or the build refuses them and says by how much — that is the check that keeps lips on their voice.

More of meta.source, all optional: audio (a separate audio file, when the sound was not recorded with the picture); tonemap: hlg for an HDR phone recording (without it the clips look washed out beside SDR ones); voiceover (the built track's asset key, default <showcase-id>-voiceover); fade (seconds of fade-out on the last thing spoken, so room tone settles instead of stopping dead); pad (trailing silence on the track, default 0.15); quality (x264 crf, default 21); loudness {segment, track} in LUFS, which gain-matches each span before joining and lifts the finished track — for a recording assembled from takes at different levels.

A cut derived from another showcase's recording names it by path: video: ../interview-berlin/assets/Interview.MOV. It reads that recording's transcript too, so its karaoke captions come from the take that heard the whole thing.

Builds are idempotent: only outputs whose inputs changed are rebuilt, so building again after one edit is quick. force rebuilds everything; only: [<scene ids>] limits it.

The transcript is the other half. Run transcribe with save: true on the recording and it writes assets/<recording>.transcript.json — whole words with their times, which is what build_media turns into the words file. Fix a mishearing there, in its corrections list: {at, text} respells the word starting at that millisecond, {at, text, through} folds the words up to through into one, {at, start, end} moves a word whisper placed early (it happens — whisper drifts through openings, and silencedetect will show you a word placed inside a silence). Corrections are re-applied after every re-transcribe, and so is a word you respell in the file itself, so transcribing again never loses your fixes. Keep a caption's word order as spoken — a caption word that doesn't match interpolates between its matched neighbours, and a caption falls back to synthetic pacing if fewer than half its words match — and fix a mishearing in the transcript rather than bending the caption to it.

Two more things about footage:
- Footage video always plays muted, in the player and in every export. The voice only ever comes from meta.soundtrack, which is why the build writes one.
- The portrait stage is 1320x2868 (aspect ~0.46) — narrower than a 9:16 phone clip, so the default fit: cover crops about 18% of the clip's width. To letterbox instead with ~10% bands top and bottom, crop the clip to the stage width over 80% of the stage height (1320:2294 ~ 0.575 — a 1080x1920 clip crops to 1080x1878) and set fit: contain; the speaker's size on screen doesn't change, cover just trades the width loss for the bands.
- Footage scenes are left out of the App Store screenshot set by default; add statement or feature scenes if the showcase also needs screenshots.

## Working rules
- Edit showcase.yaml through the edit_showcase MCP tool whenever it can express the change, and pass ifVersion (see "Working alongside the user" above) — one call applies a whole batch of field edits (retiming every scene, say) as a single validated write that preserves the file's formatting. What the tool can't express (wholesale restructuring), change with your own file-editing tool — never sed, awk, or throwaway scripts, which have mangled these files before.
- Working context lives in note fields, not YAML comments: a scene's note (what the take is, what's pending) and meta.notes (showcase-level context) travel with the data through every edit and show on the script page. Don't add YAML comments — they aren't addressable by the edit tool, and a comment above a scene does NOT follow it through scene.move or scene.delete, so banners end up labeling the wrong scene. Section labels belong in eyebrow.
- Read a file before rewriting it, and keep YAML valid — a showcase that fails to parse is shown as an error card until fixed. Referencing an asset or graphic that doesn't exist yet is fine: the slide renders a "missing asset" placeholder with a linter warning, and heals when the file lands in assets/.
- Screenshots are binary; you cannot create them. Ask the user to drop images into the showcase's assets/ folder, or to paste or drag them onto the studio's Assets page, then reference them by key. (An image pasted into the Claude chat never reaches a file you can read.)
- Keep narration natural to read aloud, and slides focused — one idea per slide.
- Never run destructive git operations (reset --hard, force pushes, deleting branches) — see "History" above for how to undo a change safely.`;

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
${
  srcDir
    ? `- The studio app's complete source is at ${srcDir} (also in
  $SHOWCASE_STUDIO_SRC). Read it when you need to know exactly how
  something works: the player and slide themes
  (src/components/showcase/), the timing model (src/content/timing.mjs),
  the data pipeline (src/content/, server/showcase-data.mjs), the studio
  server (server/studio-server.mjs), exports (server/exporter.mjs). Treat
  it as read-only reference — app changes
  belong in that repo, not in this folder.`
    : `- The studio's source isn't installed with the app, so don't look for
  it. This guide and the MCP tools' own descriptions are the reference;
  check what you make with screenshot_slide and validate.`
}
- Show the studio from the MCP tools: studio_start returns its URL as
  \`open\` — in Claude Code, open that URL in the preview panel
  (preview_start with url). Don't start a studio from a
  .claude/launch.json or the preview's start button: that runs a second
  studio, separate from the one the MCP tools use.
- When a studio page fails to render on the server, studio_start and
  studio_info report it as \`pageError\`: {message, stack, path, at}.
  It stays until a page renders again. validate and screenshot_slide
  quote it too ("The studio page failed to render: …") instead of
  saying the page didn't load. That error is the real cause: tell the
  user what it says.
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
  read_showcase {showcaseId} returns showcase.yaml as it is now, with
  its version; edit_showcase {showcaseId, edits, ifVersion} applies a
  list of structured showcase.yaml edits — scene fields, captions, meta,
  scene insert/move/delete — as one validated, comment-preserving write
  and returns the new version (see the tool's own description for the
  edit shapes); screenshot_slide
  {showcaseId, sceneId} returns a rendered image of one slide — use it
  after editing a slide, theme, or TSX diagram to see your work;
  validate reports which showcases load and the error for any that
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
  screens/ (numbered scene PNGs). A new export takes the plain name and
  keeps the previous one numbered (<id>_draft.1.mp4, screens.1/). One
  export runs at a time — the user's Export button in the studio shares
  the same queue, so an export may already be running when you start one. (The repo's npm export scripts only cover the showcases bundled
  in the app repo — for this folder, use the MCP tools.)

## Working alongside the user
The user may edit a showcase in the studio while you work on it: titles,
captions, media, caption colors, asset uploads and renames. Those edits
change the files, but nothing tells you. So:

- The studio logs every write it makes, one JSON line per write, to
  ${showcasesDir}/.studio/changes.jsonl. Each line starts with at,
  source ("ui" for the studio page, "mcp" for a tool call), showcaseId,
  and kind:

  | kind            | the rest of the line                                  |
  | --------------- | ----------------------------------------------------- |
  | edit            | file, previousVersion, version, edits — in            |
  |                 | edit_showcase's shape; theme.yaml edits are           |
  |                 | {field: "theme", group, name, value}                  |
  | asset.rename    | from, to, references (each {path, from, to}, plus     |
  |                 | sceneId inside a scene), and file and versions when   |
  |                 | references were rewritten                             |
  | asset.add       | names                                                 |
  | asset.delete    | name                                                  |
  | showcase.create | title                                                 |
  | commit          | sha, message, files — a git commit the studio made    |
  |                 | (source "studio"; see "History")                      |
  | setting         | name, value — the user changed a studio setting;      |
  |                 | showcaseId is null. Today only name "autoCommit"      |
  |                 | (the "Commit changes to git" switch; see "History")   |

- While the user works in the studio, watch that file with the Monitor
  tool, so each of their edits reaches you as it happens:

      tail -n 0 -F '${showcasesDir}/.studio/changes.jsonl' | grep --line-buffered '"source":"ui"'

  Take each edit into account before your next change. Don't redo work
  the user just changed by hand.
- Pass ifVersion to every edit_showcase call. Get the version from
  read_showcase, or use the version your last edit_showcase returned. If
  showcase.yaml changed since then, the edit is refused, nothing is
  written, and the error lists the logged changes since your version.
  Read the showcase again, check your edits against it, and retry with
  the new version.
- Your own file-editing tool has no such check. Read the file right
  before you change it.

## History
When the library is inside a git repository, the studio commits as you
go. studio_start and studio_info report it as \`history\`:
{git, autoCommit, enabled, available, branch, reason?}. autoCommit is
true when commits are really happening; enabled is the user's switch;
available is false when commits can't happen here at all (no git, no
repository, or the library is in .gitignore).

    a change in <id>/ ──► ~5 s with no more changes ──► commit of <id>/ only

- Every change counts: studio edits, edit_showcase, and files you or the
  user change directly (theme.yaml, graphics/, assets/). Only that
  showcase's folder goes into the commit; other work in the repository
  is left alone, staged or not.
- Messages say what changed and who changed it:

      nova: edit intro caption 1 text, point hook at shot-2

      Changes, oldest first:
      - edit intro caption 1 text (studio UI)
      - point hook at shot-2 (Claude, via edit_showcase)

      Showcase-Studio: auto-commit

- When you finish a meaningful step, name it: commit_showcase
  {showcaseId, message} commits the showcase now with your message
  (e.g. "Retime scenes to the new voiceover"). Call it too before you run
  git commands yourself. Don't run \`git commit\` for showcase changes.
- The user turns commits on and off with the "Commit changes to git"
  switch (the gear button at the top right of a showcase's screens). It
  applies to the whole studio and takes effect at once. It is the
  user's choice: never flip it, and never edit autoCommit in the
  studio's settings.json. A "setting" line in the change log tells you
  when they change it. While it is off, commit_showcase commits nothing
  either; if the user wants a checkpoint, tell them the switch is off.
- Nothing is committed while a merge, rebase, cherry-pick, revert or
  bisect is in progress, or on a detached HEAD. If \`history.git\` is
  false, the library isn't a git repository: offer the user to run
  \`git init\` there, and ask first.
- Using the history, when the user asks:

  | to                   | run                                             |
  | -------------------- | ----------------------------------------------- |
  | review changes       | git log --stat -- <id>   (git show <sha>)       |
  | find studio commits  | git log --grep Showcase-Studio -- <id>          |
  | undo a change        | git revert <sha>   (a new commit; never reset)  |
  | compare with before  | git diff <sha> -- <id>                          |
  | start a new cut      | git switch -c <cut-name>                        |

  Look at the history first and confirm which commit the user means. The
  studio reloads pages when a checkout or switch changes the files, and
  makes no extra commit for it.

${SHOWCASE_GUIDE}
`;
}
