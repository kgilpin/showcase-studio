/* The showcase authoring guide — the domain knowledge every Claude Code
 * session in a showcases folder needs. The studio writes it into
 * <folder>/.studio/GUIDE.md on every launch (electron/main.mjs), so it
 * always matches the running app; the seeded, user-owned CLAUDE.md
 * imports it with Claude Code's @-import syntax. */

export const SHOWCASE_GUIDE = `## The data model
Each showcase is a folder: <id>/showcase.yaml (the script), optional theme.yaml (styling), assets/ (screenshots and recordings; an asset key is the file name without extension, and the full file name also works — use it when two files share a bare name), and optional graphics/ (TSX diagrams).

showcase.yaml (the fields, their types and where each goes are in .studio/showcase.schema.json, a JSON Schema the studio writes beside this guide; a field that isn't in it, or sits in the wrong place, is a validate warning naming where it belongs):
- meta: title, description, loop, optional soundtrack {src, volume, sync?}, optional voiceover {voice, engine, profile, region, track} (a synthesized voice reads the captions — see "Synthesized voiceovers"), optional notes (showcase-level authoring notes — shown on the script page, never rendered in the player or exports), optional pace (narration reading speed in words/second, default 2.5), optional sceneMaxMs and targetMs (the longest any scene should run, and what the whole video should add up to, in ms — see "Length" below), optional tiktok {fit, focus, bands} (how every scene's picture goes into the 9:16 TikTok frame — see "TikTok fit"). soundtrack.src may be an asset key, a root-relative path, or a URL; sync: true marks it a voiceover locked to the scene timeline (skips/loops/unmutes stay in sync) — leave unset for free-running music beds. Optional embedCaptions (true | false) decides whether the 4:3 embed lays captions over the media on console slides; leave it unset to follow the voiceover: hidden when a synced soundtrack is set (the voice already carries the narration), shown otherwise. The player's 4:3 captions toggle writes it; its reset removes it. Optional view (tiktok | screens | embed) is the player view the showcase opens in, for one made for a single destination — an explainer for YouTube and desktop embeds is worked on in the 4:3 view, so view: embed saves switching to it on every reload; unset opens in TikTok view. The Share page opens on the matching destination too (embed → YouTube, tiktok → TikTok). The pin button beside the player's view switch writes it; edit_showcase sets it with {field: "meta.set", name: "view", value: "embed"} (null removes it). Optional watermark — the persistent brand mark, see "Brand mark" below.
- scenes: a list of slides with fields: id; theme; optional title (on-screen display text ONLY — never spoken, never timed; omit it on scenes that don't display one); optional eyebrow (a label shown only on the teleprompter and script pages — never on slides); optional note (the scene's authoring note — what a take is, what's still pending; script page only, never rendered); captions (the narration: list of {text, durationMs?, position? — see "Caption position" below}); optional captionStyle (chip | karaoke | reveal — worded styles paint overlay captions word by word, paced by the reading model, or exactly synced when assets/<soundtrack-src>.words.json holds the transcribe tool's word timestamps; meta.captionStyle sets it showcase-wide). Caption colors are themeable in theme.yaml: colors.caption-chip / caption-text / caption-word, and atmosphere.gradient-stage is the slide background; media; optional support (small supporting line, statement slides); optional cta {label, url, kind?} plus ctaNote (a small note line under the button) — kind defaults to app-store, which draws the App Store badge; kind: github draws a "View on GitHub" badge with GitHub's mark; kind: link draws a labeled pill button for any other destination — every theme renders them: statement centers them under the text, the stacked layouts pin them below the media; export: false leaves the scene out of the App Store screenshot set (the video always includes every scene; footage scenes default out — export: true opts one back in); optional watermark (false | true | a map) overrides the showcase's brand mark for this slide; durationMs pins a slide's timing explicitly (on a showcase cut from a recording or voiced by meta.voiceover, the build writes it — see "Recorded pitches" and "Synthesized voiceovers" — so don't set it by hand there); maxMs is the longest this one slide should run, overriding meta.sceneMaxMs (see "Length"); take names the span of the master recording the scene owns, on those showcases only; transition: rise opts a slide into the rise/drift-in entrance animation (off by default so scenes cut cleanly).
- Themes are layouts, nothing more: "statement" — centered display text (claims, intros, outros; optional app-mark media above the title, full-bleed media becomes a dimmed backdrop; optional CTA); "feature" — title header over a phone-framed screenshot; "console" — title above a wide landscape media panel (desktop screenshots, TSX diagrams); "footage" — the media IS the slide, edge-to-edge with no title (on-camera segments; captions act as subtitles in the video presentation). "title" is a legacy alias for statement. A theme linter warns (diagnostics tray at the bottom of the app, and per-scene in the player and validate tool) on legacy or incoherent themes but always renders — never leave warnings unresolved.
- media: {kind: none} or {kind: image|video, asset: <key>, alt, motion? zoom-in|zoom-out|pan-up|pan-left|still, frame? phone|full|mark, fit? cover|contain, align? top|center|bottom, tiktok? {fit, focus, bands} — see "TikTok fit" below, overlay? <graphic key> — a TSX graphic drawn over the picture, see "Pointing at things in a recording", fadeTo? {asset, alt, align?}, speed? (video only: the clip's playing rate, 0.25–4 — see "Length")}. motion defaults to zoom-in for images and still for video. fadeTo works on image media only — a video never fades to a still.
- TikTok fit: the TikTok view and the TikTok video are 1080x1920 (9:16), TikTok's own shape; App Screens stays 1320x2868, the App Store size. A picture that isn't 9:16 — an iPhone screen recording or App Store screenshot is 1320x2868, taller and narrower — goes into the TikTok frame by its tiktok fit. fit: fill fills the frame and crops what sticks out (a 1320x2868 recording loses about 18% of its height); focus picks what stays: top, center, bottom, or a percentage that slides the kept part from the top (0%) to the bottom (100%). fit: fit shows the whole picture, smaller (a 1320x2868 recording fills about 82% of the width), with bands beside it: bands: blur fills them with a blurred copy of the picture (TikTok's usual look), bands: color leaves the plain stage background. meta.tiktok sets it for every scene ({fit: fill, focus: 40%}); a scene's media.tiktok wins field by field. What neither sets comes from the media's fit and align: cover means fill, contain means fit with plain bands, align is the focus — so leaving it all unset keeps a scene as it was. It applies only to image and video media outside the console theme, and never to the app mark (frame: mark). area puts the picture in one part of the frame instead of the whole of it, as insets from each edge in percent of the frame — fit and fill then work inside that box, and blurred bands still fill the whole frame. Use it to keep a picture clear of the captions and of TikTok's interface: with captions at 16% and up to three lines, {top: 31%, right: 16%, bottom: 25%, left: 5%} keeps a picture below them and out of every area TikTok covers. Set it once in meta.tiktok. Check it in the TikTok view: its Safe area switch shades where TikTok's tabs, buttons and description will cover the frame, and the sides a tall phone crops.
- Captions are the narration, read verbatim in order — one continuous voiceover across the whole showcase; they are the ONLY spoken lines (titles never are). The player previews the export destinations as three view modes: App Screens (titles on the slide, captions in the transcript column), TikTok (captions overlaid, titles hidden), and 4:3 (the embed canvas, which composes its own captions — console slides overlay them on the media unless meta.embedCaptions turns that off, which a synced voiceover does by default). A caption identical to the scene's displayed title is not drawn on the slide (the title already says it) but is still narration.
- Caption position: where an overlay caption sits on the slide. A preset — top, center, lower (centered 60% down), or bottom (the default) — or an exact height like 14%, which puts the caption's top edge that far down the slide in every format. Each format places the presets at its own height. The TikTok video is 9:16, and in the TikTok app it fills the screen above TikTok's tab bar, which covers about the top 13% of it (status bar, For You / Following tabs, search) and the bottom 25% (username, description, sound), plus a column of buttons down the right side; so in the TikTok video top puts the caption's top edge 13% down (where TikTok puts its own captions) and bottom puts its bottom edge 25% up; in the TikTok video a caption also keeps clear of the buttons column (the right 16%) and the left 5% a tall phone crops, so it sits a little left of center; the 4:3 embed has nothing laid over it, so there top is 6% down and bottom 8% up. An exact height is the same in every format, so keep one between 13% and about 70% if the video is for TikTok. On a screen recording, pick the spot that covers the least important part of the screen — often a header strip just below 13% (top, or an exact height such as 14%) rather than center or lower, which tend to sit on the action. Keep an overlay caption to two lines in the TikTok frame (about 60 characters at the caption size): a whole sentence wraps to three or four, climbs the frame, and covers more of the picture — on a speaker, the face. Split a long line into two captions at a clause; the words still read as one sentence.
- publish (optional, top level beside meta and scenes): the text the video is posted with — see "Sharing" below. It never changes the video itself.
- Timing derives from the copy by default: each caption prices out at its reading time (words at meta.pace plus settle and punctuation beats), and a slide is exactly long enough to speak its lines. Only pin durationMs when there is a concrete reason — and on a showcase cut from a recording, never by hand: its take decides, and build_media writes the pin.
- Length: a generated showcase runs long when its slides carry too many words, and nothing says so until someone watches it. Set meta.sceneMaxMs (the longest any scene should run, in ms — 8000 is a good default for a product video) and meta.targetMs (what the whole video should add up to — 60000 for a TikTok). They change nothing in the timing: the linter warns about every scene over its maximum, saying how far over and why ("24.4 s long, 12.4 s over the 8 s maximum: pinned by durationMs (a video clip: media.speed plays it faster); 5 captions, 61 words"), and about a showcase over its target, naming its longest scenes; validate returns the same warnings, and the player's scene rail marks the long scenes in amber and shows the total against the target. One scene that must run long (a clip that can't be cut) sets its own maxMs. Draft to the limit from the start: two captions per slide, one idea per slide, and at 2.5 words a second an 8 s slide holds about 15 words. To bring a scene down, from the best fix to the least: cut the copy (too many captions, a list of jargon, a detail the story doesn't need — no setting fixes this, and the scene rail shows each scene's caption and word count on hover); play a video clip faster with media.speed (2 halves a screen recording's time in the player and every export, with no re-encoding; then shorten the scene's durationMs to the clip's length ÷ speed); split a long scene in two. When a pinned scene's durationMs changes through edit_showcase, captions that carry their own durationMs are re-scaled by the same ratio, so they still add up — no arithmetic by hand. Never fix a long scene with a faster meta.pace: that hides long copy instead of cutting it, and captions become unreadable.

theme.yaml (optional; its keys and what each holds are in .studio/theme.schema.json, a JSON Schema the studio writes beside this guide. A key that isn't in it, a value of the wrong kind, or an extends naming no showcase is left out with a validate warning — the showcase still shows, with the rest of its theme): whitelisted styling — colors, fonts {display, body, load: [stylesheet urls]}, shape {radius}, atmosphere {gradient-stage, gradient-accent, shadow-device}; extends: <other-showcase-id> inherits another showcase's theme. Change it with the edit_theme tool ({showcaseId, edits: [{key: "colors.primary", value: "#4ade80"}], ifVersion}), not by hand: the tool checks each key and value, quotes what needs quoting, keeps the file's comments, and the studio logs and commits the write. If you do edit theme.yaml by hand, put quotes around any value that contains a # (a hex color, a gradient): in YAML a space followed by # starts a comment, so an unquoted "linear-gradient(100deg, #34e7d6, #0a8f95)" is cut to "linear-gradient(100deg,". The studio warns about a value cut like this and leaves it out.

showcase_settings.yaml (in the library root, beside the showcase folders): settings for the whole library, not for one showcase. It also marks the folder as a library; the studio writes it, all comments, when it opens a library that has none. Its settings: show_in_recent: false keeps the folder out of File > Open Recent in the desktop app; export_dir: <folder> puts the library's exports there (relative to the library root, or absolute; one subfolder per showcase) instead of ~/Downloads/showcase-exports; aws_profile: <name> is the AWS profile the synthesized voiceovers are made with, and aws_region its region when the profile has none (see "Synthesized voiceovers"). A setting may name an environment variable as \${NAME}, replaced when the file is read: a committed aws_profile: \${USER} works for everyone whose profile is named after their login. Don't delete it, and don't put a showcase.yaml in the library root — that name belongs to each showcase's script. (Older libraries kept these settings in a root showcase.yaml; the studio renames it when it opens the library.)

## Brand mark (the corner "bug")
meta.watermark draws a small logo in one corner of every slide, the way a TV network's bug sits in the corner of a broadcast — for branded editorial cuts (an interview, a founder clip) where the viewer should see whose work it is throughout.

    meta:
      watermark:
        asset: my-brand-mark     # asset key, root-relative path, or URL
        text: My Brand           # optional wordmark beside the image
        position: top-left       # top-left | top-right | bottom-left | bottom-right
        inset: 13%               # optional: how far from the top (or bottom) edge, 0-50%
        shade: true              # optional: a dark panel behind the mark (true, or an opacity 0-1)
        opacity: 0.85            # 0-1
        scale: 1                 # 0.25-3, on top of the canvas's own bug size

- asset, text, or both — one of them must be there. The asset must be an image file; a video or audio file warns and isn't drawn. Everything else has a default: position top-left, opacity 0.85, scale 1, no inset (the canvas's own corner inset), no shade.
- inset keeps the mark in its corner but pushes it down (from a top corner) or up (from a bottom corner) to that height, in percent of the frame, the same in every format — like an exact caption height. Use it for TikTok, whose own interface covers about the top 13% of the video: inset: 13% puts the mark where TikTok puts its own captions, just below the tabs. Check it in the TikTok view with the Safe area switch on.
- shade draws a dark rounded panel behind the mark and wordmark, for footage where the mark's drop shadow alone doesn't keep it legible — a pale sky, a white wall. true is a medium shade (0.45); a number is the panel's opacity.
- It is a CORNER mark, by design: there is no banner position. A full-width band across the frame reads as an ad unit and competes with the captions and the speaker's face. The default corner is a top one because the bottom of the frame belongs to the captions, and in the video export to the platform's own UI as well.
- Use an IDENTITY mark — a logo, a wordmark. Do NOT use the App Store badge: it is a call to action, and Apple's guidelines give it clear-space and minimum-size rules a small persistent copy would break. The badge belongs on the end card, which is what a scene's cta field is for.
- The 0.85 default keeps the mark readable over busy footage; its small corner size is what makes it read as authorship rather than advertising. Lower the opacity only over calm, even backgrounds — a faint mark disappears on video.
- The mark draws on every slide, in every destination: all three player view modes (App Screens, TikTok, 4:3), the TikTok and 4:3 video exports, and the App Store screenshot set.
- Per scene, watermark: false leaves the bug off that slide, watermark: true forces it on, and a map (e.g. {position: bottom-right, opacity: 0.3}) overrides a field or two for that slide only. An empty asset or text in that map ({text: ""}) drops the image or the wordmark on that slide.
- One default: a statement slide whose media IS the app mark (frame: mark) skips the bug — the logo is already the hero there, and a second small copy of it looks like a mistake. That is the usual end card. watermark: true on such a scene puts it back.
- The wordmark is white. theme.yaml's colors.watermark-text changes it (caption colors don't affect it).
- The mark is decorative chrome: it is hidden from screen readers (so the same logo isn't announced on every slide) and never takes a click.

Custom TSX diagrams: write <id>/graphics/<key>.tsx default-exporting a React component (no imports needed — JSX only; you may not import anything besides react), and reference it as media {kind: graphic, graphic: <key>, alt: ...} — usually with theme: console. Animate with CSS only (inline <style> keyframes; no JS timers) and make the resting state the fully revealed diagram; style with the theme's CSS variables (e.g. var(--card), var(--primary)). Compile or runtime errors render inside the slide, so read the slide's error and iterate until it renders.

## Pointing at things in a recording (overlays)
A screen recording or a game replay plays through, and the viewer can't tell where to look. media.overlay draws a TSX graphic on top of an image or video — a ring round the fleet that matters, an arrow to a star, a label on a player's territory — timed to the clip:

    media: {kind: video, asset: clip-betrayal, alt: "...", overlay: betrayal-marks}

- Write <id>/graphics/<key>.tsx exactly like a diagram (no imports, CSS animation only), and name it in overlay. The same file can't also be the scene's media; an overlay is always drawn over a picture.
- Its box covers exactly the picture as shown — not the slide. With fit contain the bands stay outside it; with cover (or TikTok fill) the box is as big as the whole picture and the cropped part is clipped. So one overlay lands on the same spot in App Screens, TikTok and 4:3, whatever each view's fit. It moves with the picture's motion (a zoom-in zooms both).
- Draw in the picture's own pixels: an svg with viewBox "0 0 <width> <height>" of the source (the video's size, e.g. 796x820), width and height 100%, and preserveAspectRatio "none". Then a ring at a star is the star's pixel position in a frame grabbed with ffmpeg. Keep strokes and text readable at phone size: a picture shrunk to fit a 9:16 frame shows at about the width of the phone.
- Time it to the clip with animation-delay: the overlay mounts when the scene starts, which is when the clip starts at 0, and the video recorder scrubs both on one clock, so a ring with animation-delay 1.5s appears 1.5 s into the clip in every export. Use animation-fill-mode both, so a mark waits invisible before its delay and holds after. For a mark that follows something moving, give its keyframes positions read from frames at those times.
- A clip loops if its scene runs longer than the clip; the overlay doesn't. Pin the scene to the clip's length (as a cut list does) so they stay together.
- As with diagrams, the screenshot export turns animation off, so each mark's plain style (no animation) is what the still shows: write the style a mark has when it is fully shown, and let the keyframes bring it in from hidden. A mark meant to disappear mid-clip still shows on the still.
- An overlay whose file is missing warns and leaves the picture plain.

## Recorded pitches (on-camera footage)
A talking-head recording — a phone selfie video, an interview — becomes a showcase by naming the recording once and giving each scene the span of it that scene owns. The studio builds everything else. Never cut clips, join a voiceover, or work out durationMs by hand or with a script: they all come from the same list, which is the only reason the picture and the voice stay together.

    meta:
      source:
        video: Interview.MOV      # the master recording, in assets/
        speed: 1.1                # applied to picture and sound (0.5-2)
    scenes:
      - id: alex-intro
        theme: footage
        take: {from: 28.300, to: 35.600}   # seconds in the recording

The studio builds it a few seconds after the cut list, the recording or the transcript changes, and before any export or screenshot, so there is nothing to press: the Actions list (the slot in the top bar) shows the build waiting, running and done, and studio_info's media says whether a showcase is up to date. build_media is the way to force a rebuild, to build only some scenes, or to get a jobId to wait on with build_status {waitMs} before you look at the result. The build writes:
- assets/<voiceover>.mp3 — every scene's audio spans joined in order and retimed, which is the showcase's voice. It is set as meta.soundtrack {sync: true} on the first build.
- assets/clip-<scene>.mp4 — one muted clip per footage scene, cut frame-accurately.
- assets/<voiceover>.words.json — the recording's transcript remapped onto this cut, for karaoke and reveal captions.
- durationMs on every scene, written into showcase.yaml for you.

Three kinds of scene, so every scene must have a take:
- take: {from, to} on a footage scene — a clip is cut and its sound is kept.
- The same take on any other theme — the scene shows its own screenshot or diagram while the voice keeps talking. clip lives inside the take, not on the scene: take: {from, to, clip: false} overrides the default either way (the build ignores a clip field on the scene itself, and edit_showcase refuses one). A footage scene that shows its own media instead of a speaker clip — a cutaway, the app mark — needs clip: false in its take, or the build cuts a speaker clip nobody shows.
- take: {silence: 5.0} — a card with nothing spoken over it. The voiceover gets that much silence, so the timeline still lines up.

A scene can keep more than one span, which is how a pause or a fluffed sentence is dropped: take: [{from: 0, to: 5.53}, {from: 5.88, to: 10.16}]. When the picture should fast-forward through a pause instead of cutting to a jump, give the sides their own spans and squeeze the pause with fit — the seconds it plays in:

    take:
      audio: [{from: 0, to: 5.53}, {from: 5.88, to: 10.16}]
      video: [{from: 0, to: 5.31}, {from: 5.31, to: 6.10, fit: 0.44},
              {from: 6.10, to: 10.16}]

The two sides must last exactly the same, or the build refuses them and says by how much — that is the check that keeps lips on their voice.

How a span is cut: the sound is cut at exactly from and to (whisper's times run up to half a second late near the end of a sentence, so put a cut in the silence ffmpeg's silencedetect finds, not on the last word's time), with a few milliseconds of fade at each join so nothing clicks; the clip is cut at the same times, frame for frame; and each scene's durationMs is its spans' length rounded onto a 10 ms grid along the whole timeline, so the pins add up to the track exactly. A cut that lands mid-word in one scene and the next is the same recording on both sides, so the join is seamless on the picture, but the voice will sound cut: cut in pauses.

More of meta.source, all optional: audio (a separate audio file, when the sound was not recorded with the picture); tonemap: hlg for an HDR phone recording (without it the clips look washed out beside SDR ones); voiceover (the built track's asset key, default <showcase-id>-voiceover); fade (seconds of fade-out on the last thing spoken, so room tone settles instead of stopping dead); pad (trailing silence on the track, default 0.15); quality (x264 crf, default 21); loudness {segment, track} in LUFS, which gain-matches each span before joining and lifts the finished track — for a recording assembled from takes at different levels.

A cut derived from another showcase's recording names it by path: video: ../interview-berlin/assets/Interview.MOV. It reads that recording's transcript too, so its karaoke captions come from the take that heard the whole thing.

Builds are idempotent: only outputs whose inputs changed are rebuilt, so a build after one edit is quick. force rebuilds everything; only: [<scene ids>] limits it. While the cut list is half written (a take missing), the studio reports that once in the Actions list and waits; it builds as soon as the list reads. The "Build media when it changes" switch under the gear button turns the automatic build off; the build still runs before an export, and on request.

The transcript is the other half. Run transcribe {showcaseId, asset: <recording key>, save: true} (or {file: <path>, save: true}) and it writes assets/<recording>.transcript.json — whole words with their times, which is what build_media turns into the words file. Fix a mishearing there, in its corrections list: {at, text} respells the word starting at that millisecond, {at, text, through} folds the words up to through into one, {at, start, end} moves a word whisper placed early (it happens — whisper drifts through openings, and silencedetect will show you a word placed inside a silence). Corrections are re-applied after every re-transcribe, and so is a word you respell in the file itself, so transcribing again never loses your fixes. How caption words find their times: the captions are read as one continuous narration, so each caption's words are matched to the transcript's words in order, each looked for among the next eight transcript words, ignoring case and punctuation ("Kids?" matches "kids"). A caption word with no match takes a time between its matched neighbours; a caption with fewer than half its words matched keeps the estimated pacing instead. So keep a caption's word order as spoken, write words the way whisper hears them, and fix a mishearing in the transcript rather than bending the caption to it. The guide says this so you don't have to read the studio's source to learn it.

Two more things about footage:
- Footage video always plays muted, in the player and in every export. The voice only ever comes from meta.soundtrack, which is why the build writes one.
- The TikTok frame is 9:16 (1080x1920), the shape a phone selfie video already has, so a speaker clip fills it with nothing cropped. A clip cut to another shape goes in by its tiktok fit (see "TikTok fit"): fill crops it, fit shows it whole with bands. App Screens stays 1320x2868 (aspect ~0.46), where fit: cover crops about 18% of a 9:16 clip's width.
- Keep the face clear of the captions. A selfie puts the face in the middle of the frame, and the bottom caption (the default) covers about the 62–75% band of the frame's height with two lines, so a chin below about 58% sits under the words. The check_framing tool looks for this: for every caption on a scene whose picture fills the frame it renders the frame at the middle of the caption, finds the faces, and reports each caption whose chip covers one, saying where both are and the fix. Prefer lifting the picture: media.tiktok {fit: fill, focus: bottom, bands: blur, area: {bottom: N%}} moves a 9:16 clip up N% of the frame and fills the strip below it with a blur, under TikTok's description where nothing is lost — the warning gives N. Moving the caption (position: top) is the fallback when the face is low or the sky is empty. Set it on each speaker scene (a cutaway or a composite frames itself), then check with screenshot_frame at the time the report names. On Windows the face finder isn't available and the tool says so: look at the frames yourself.
- The end card of a recorded pitch, when the last line names the App Store: a composite of the listing and the speaker in a small window, made with the ffmpeg tool from the scene's own clip (the build cuts it; then take: {from, to, clip: false} on the scene, and the composite as its media). Crop the listing to its icon and title, large, on a plain dark stage — never the whole page: the page's buttons, banners (a TestFlight notice, a rating row) and small text read as clutter at phone size and fight the caption. Put the speaker window bottom-right, clear of TikTok's buttons column, and the caption in the gap (position: center). Take the listing picture on a device without the app, so the button reads Get.
- Footage scenes are left out of the App Store screenshot set by default; add statement or feature scenes if the showcase also needs screenshots.

## Synthesized voiceovers (AWS Polly)
A showcase with no recording can be read aloud by a synthesized voice: AWS Polly, on the user's own AWS account, through the aws command. Name the voice once in meta, and the studio makes everything else from the captions:

    meta:
      voiceover:
        voice: Matthew            # a Polly voice id (default Matthew)
        engine: generative        # generative | neural | standard | long-form
        profile: my-aws-profile   # optional — else the library's aws_profile (see below)
        region: us-east-1         # optional — else the library's aws_region, else the profile's, else us-east-1
        track: voiceover          # the asset key (default voiceover)

The studio builds it a few seconds after a caption or the voice settings change, and before any export or screenshot; build_voiceover forces a rebuild or gives you a jobId to wait on. The build writes:
- assets/<track>.m4a — one Polly clip per caption, each in its own window: 250 ms of silence, the spoken clip, 450 ms of silence; the last caption holds 1.5 s more for the end card (leadMs, tailMs and holdMs change those). It is set as meta.soundtrack {sync: true} on the first build.
- durationMs on every caption, pinned to its window, so the pins add up exactly to the track. A scene is pinned too when the player would otherwise time it differently (support text, or the floor for short slides). A scene with no captions is silence for as long as it shows.
- assets/<track>.words.json — karaoke word times: one segment per caption window, the caption's own words, timed by whisper hearing that caption's clip and fitted to where the clip is voiced.

A caption edit is rebuilt on its own, and it is quick: clips are cached by voice, engine and text, so only the captions that changed call Polly. force makes every clip again. Never pin durationMs by hand on a voiced showcase, and never make the voice with your own Polly or ffmpeg calls or a script — the pins would stop matching the track.

The voice reads the caption exactly as written, so spell a caption the way it should sound. A showcase is either voiced (meta.voiceover) or cut from a recording (meta.source), never both.

To voice some scenes and not others — a voice tried on one scene before the whole script, or one spoken scene among slides that time themselves — list them in meta.voiceover.scenes: [open, outro], or call build_voiceover {showcaseId, only: [sceneId, …]}, which writes that list for you. The voice reads only those scenes; every other scene keeps its own timing (its pins, or the reading model) and is silence on the track for as long as it shows, so the track and the pins still add up. Leave the list out to voice every scene. A scene with no captions is silence either way.

Which AWS account pays for the voice is the user's choice, never yours. Polly is called through the aws command with the showcase's profile, else the library's aws_profile in showcase_settings.yaml, else AWS_PROFILE, else the aws command's default profile — and a machine with named profiles only has no default. Before voicing the first showcase in a library, ask the user which AWS profile to use and put it in showcase_settings.yaml at the library root as aws_profile (\${USER} there names the profile called after the login name, so the committed file works for a team; aws_region sets the region when the profile has none, else the build uses us-east-1 and says so in its notes). The studio checks the setup before any build: when nothing names a profile this machine has, the media status in studio_info and validate, and the Actions list, say so and list the machine's profiles — ask the user, don't pick one. Keep profile and region out of the showcase itself unless the user wants that one showcase on another account: a showcase ships to other people. If the build says the aws command isn't signed in, tell the user the command it names (e.g. aws sso login --profile <name>) — it's theirs to run. Without whisper the words file still gets written, with word times spread by length, and the build's notes say so: tell the user, as with any estimated timing.

## Sharing (TikTok, Instagram, YouTube Shorts, YouTube)
The studio doesn't post for the user, and it uses none of the platforms' APIs. It gets everything ready, and the user posts on the platform's own upload page or from their phone. The studio's Share page (in the rail down the left, below Video, Script and Assets) walks through it; the share tools do the same from here.

What each destination takes (the id is what share, share_record and publish.set call it):

    destination      id          video                              text                          limits the studio checks
    TikTok           tiktok      the full-quality 9:16 export       caption + hashtags            4000 characters together; 10 minutes
    Instagram        instagram   (kind "video") — the same file     caption + hashtags            2200 characters together; 30 hashtags; 3 minutes (posts as a Reel)
    YouTube Shorts   youtube     for these three                    title, description, hashtags  title 100 characters; description 5000; 60 hashtags; 3 minutes
    YouTube          youtube43   the 4:3 export (kind "video-43")   title, description, hashtags  title 100 characters; description 5000; 60 hashtags; any length

YouTube (youtube43) is a regular video upload, for a showcase made for the 4:3 embed — an engineering explainer with console slides, watched on a desktop. The same upload dialog takes both: a vertical video under 3 minutes becomes a Short, a 4:3 video a regular video. A showcase with view: embed opens the Share page on it.

The text lives in showcase.yaml's top-level publish: block. There is one default for every destination, and each destination can override any field:

    publish:
      caption: Mirror your iPhone to any screen in 10 seconds.
      hashtags: [iphone, productivity]
      tiktok:    { hashtags: [iphone, techtok] }    # replaces the default list
      instagram: { caption: Mirror your iPhone to any screen. Link in bio. }
      youtube:   { title: Mirror your iPhone in 10 seconds }        # the Short
      youtube43: { title: Mirror your iPhone — the full walkthrough } # the regular video

- A field nothing sets falls back: the caption to meta.description, the title (YouTube Shorts and YouTube) to meta.title. Each destination's block stands on its own: youtube43 never inherits from youtube, so the long video and the Short can carry different titles.
- Hashtags are a list of words without the #. On YouTube, caption is the description.
- Write it with edit_showcase: {field: "publish.set", destination?, name, value}, name caption | hashtags | title. Leave destination out for the default. null or "" removes a field, so it inherits again. The Share page's text fields make the same edit.
- Then call share_status. It gives each destination's final text (\`from\` says where each field came from), the text to paste, and \`problems\` — anything over a limit, a missing title, a video too long. Fix every problem.
- Changing the publish block never makes the export stale; changing anything else in the showcase does.

Writing the text:
- Start from the narration (the script tool). The first line is the hook: TikTok shows about the first 150 characters before "more", Instagram Reels about 55 to 125.
- TikTok: a short caption and 3 to 5 hashtags. Instagram: a caption that ends with a call to action ("Link in bio" — Instagram captions have no clickable links). YouTube Shorts and YouTube: a title under 100 characters; the description can be longer, and a regular video's can say what the viewer will learn and link to the project.
- Put no Showcase Studio branding in the text: TikTok's rules forbid a tool's branding on shared posts. The showcase's own brand mark is fine.

Posting:
- The video must be a current export of the kind the destination takes (its exportKind in share_status): share_status shows exports.video.current (full quality) and exports["video-draft"].current (the draft) for TikTok, Instagram and YouTube Shorts, and exports["video-43"].current and exports["video-43-draft"].current for YouTube — or null when there is none or the showcase changed since. Each has estimateMs, about how long a new one takes on this machine — roughly 5½ minutes for the full video of a one-minute showcase, and under 2 minutes for its draft. Confirm with the user before a full export {kind: "video"} or {kind: "video-43"}.
- The draft (half size, 12 fps) is for trying the steps out without waiting for a full render: every step works the same with it. Post the full-quality video for real. share and the Share page take either one (quality: "draft").
- share {showcaseId, destination} hands the video off from this computer: it copies the caption to the clipboard, opens the upload page in the user's browser, and selects the video in Finder or Explorer. Tell the user to drag the file onto the page, paste, and post. Ask which destination if they didn't say; a showcase with view: embed is made for YouTube (youtube43).
- To post from a phone, send the user to the Share page (share_status gives its URL as page): on a Mac it AirDrops the video, which lands in Photos, and the copied caption reaches an iPhone's clipboard too.
- When the user has posted, ask for the post's link and keep it with share_record {showcaseId, destination, url}. The Share page lists every hand-off with its link.
- The studio keeps its records of exports and hand-offs in .studio/exports/ and .studio/publishes/ (one small JSON file each). Don't edit them; the videos stay in ~/Downloads/showcase-exports/<id>.

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
/** How to get a whisper.cpp binary on this machine, as indented guide
 *  lines. whisper.cpp publishes builds for Windows and Linux on its
 *  b#### tags, but for macOS only an xcframework — no whisper-cli — so
 *  a Mac gets Homebrew's. (Once the app carries its own copy, this is
 *  only for a machine without one.) */
function whisperAdvice(platform) {
  if (platform === "darwin") {
    return `  Install one with \`brew install whisper-cpp\`, or point
  $SHOWCASE_STUDIO_WHISPER at a whisper-cli binary.`;
  }
  if (platform === "win32") {
    return `  Download whisper-bin-x64.zip from a whisper.cpp build release
  (github.com/ggml-org/whisper.cpp/releases — the b#### tags carry the
  builds; the version tags often carry none) and point
  %SHOWCASE_STUDIO_WHISPER% at whisper-cli.exe.`;
  }
  return `  Download whisper-bin-ubuntu-x64.tar.gz (or -arm64) from a
  whisper.cpp build release (github.com/ggml-org/whisper.cpp/releases —
  the b#### tags carry the builds), or install a package that provides
  whisper-cli, and point $SHOWCASE_STUDIO_WHISPER at it.`;
}

export function studioGuide({
  version,
  srcDir,
  ffmpegPath,
  whisperPath,
  platform = process.platform,
  showcasesDir,
  staleClaudeMd,
}) {
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
  check what you make with screenshot_slide, screenshot_frame and
  validate.`
}
- Show the studio from the MCP tools: studio_start returns its URL as
  \`open\` — in Claude Code, open that URL in the preview panel
  (preview_start with url). A showcase page takes ?view=tiktok|screens|embed
  to open in that player view (studio_start's \`view\` adds it), which
  wins over the showcase's meta.view. Don't start a studio from a
  .claude/launch.json or the preview's start button: that runs a second
  studio, separate from the one the MCP tools use.
- When a studio page fails to render on the server, studio_start and
  studio_info report it as \`pageError\`: {message, stack, path, at}.
  It stays until a page renders again. validate, screenshot_slide and
  screenshot_frame quote it too ("The studio page failed to render: …") instead of
  saying the page didn't load. That error is the real cause: tell the
  user what it says.
- ffmpeg is bundled with the studio at ${ffmpegPath ?? "(unavailable)"}
  (also in $SHOWCASE_STUDIO_FFMPEG). Anything ffmpeg makes FOR a
  showcase — a scene's clip cut from the master recording, an audio
  track, a transcode — goes through the ffmpeg MCP tool: ffmpeg
  {showcaseId, output, args}, where output is the file's name in
  assets/ and args is ffmpeg's command line without the output path,
  as a list (run from the showcase folder, so inputs are
  assets/master.mov). The studio writes the output somewhere else and
  renames it into assets/ when ffmpeg succeeds, so the player never
  sees half a file, a clip that is on screen can be re-cut, and the
  write works in a cloud-synced folder, where writing straight over a
  file the studio is showing can fail with "Operation timed out".
  Never point your own ffmpeg command at assets/. Running ffmpeg
  yourself is fine for reading: probing a duration, grabbing a frame
  into a temporary folder, silencedetect.
- Voice-to-text: the transcribe MCP tool returns sentence segments with
  per-word timestamps for any recording. Use it whenever you need to
  know WHAT is said WHEN — aligning narration to scenes, splitting a
  voiceover into scene-scoped clips (transcribe, match the caption text
  to the word timestamps, cut with the ffmpeg tool at those boundaries), or
  verifying spoken words. ffmpeg's silencedetect only finds pauses;
  prefer transcribe for anything word-aware.
${
  whisperPath
    ? `  It runs whisper.cpp, which ships with the studio (this one is at
  ${whisperPath}, also in $SHOWCASE_STUDIO_WHISPER). The speech model is
  separate and downloads once, on the first transcription — say so if
  the user is waiting.`
    : `  It runs whisper.cpp, which is NOT installed on this machine, so
  transcribe fails until one is.
${whisperAdvice(platform)}
  Without it you cannot know when a word is spoken, so caption timings
  can only be estimated from how long each line takes to read. That
  estimate drifts from the real voice. If you time captions that way,
  say so plainly — never let the user believe the words are aligned to
  the recording.`
}
- The studio exposes MCP tools (server "showcase-studio", preloaded in
  studio-opened sessions; a session you start yourself gets them with
  \`claude --mcp-config .studio/mcp.json\` from the library root):
  create_showcase {name} makes a new showcase folder from a name (the
  studio's + card: a one-scene starter showcase.yaml and an empty
  assets/) and returns its id — start a new showcase with it, never by
  writing the folder yourself; read_showcase {showcaseId} returns
  showcase.yaml as it is now, with
  its version; add_asset {showcaseId, files: [{path, name?}]} copies
  files on this machine into the showcase's assets/ and returns each
  asset's key — use it for an image or video the user dropped into the
  chat (Claude Code writes those to a file and gives you its path) and
  for screenshots you captured yourself, instead of asking the user to
  move files by hand; ffmpeg {showcaseId, output, args} runs the bundled
  ffmpeg and puts its output in assets/ as output, replacing a file of
  that name — the way to make every clip or track (see "ffmpeg is
  bundled" above); edit_showcase {showcaseId, edits, ifVersion} applies a
  list of structured showcase.yaml edits — scene fields, captions, meta,
  scene insert/move/delete — as one validated, comment-preserving write
  and returns the new version (see the tool's own description for the
  edit shapes — on a recorded pitch, a scene's take is one of them, so
  retime a scene with scene.set take and then build_media); screenshot_slide
  {showcaseId, sceneId} returns a rendered image of one slide — use it
  after editing a slide, theme, or TSX diagram to see your work;
  screenshot_frame {showcaseId, atMs, view?, safeArea?, animations?}
  returns the video's frame at a time (or a list of times, one image
  each) exactly as the export renders it — overlay captions, TikTok fit,
  brand mark — with a line naming the scene and caption showing then;
  view "tiktok" (default) or "43", safeArea: true shades TikTok's
  interface, animations: "live" keeps them at that moment instead of
  finished. Use it for every "at time T, is X right?" check instead of
  a draft export;
  validate reports which showcases load and the error for any that
  don't — use it after YAML edits; check_framing {showcaseId} finds
  captions that sit over a face in the TikTok video and says where
  both are and the fix (see "Keep the face clear of the captions"
  under "Recorded pitches"); script {showcaseId} returns the
  narration as share-ready plain text (scene headers + spoken lines).
- Exports run through the MCP export tools as background jobs: export
  {showcaseId, kind} starts one and returns a jobId immediately; poll
  export_status {jobId} while you keep working, and export_cancel stops
  it. Kinds: "video-draft" — a fast, small MP4 (12fps, half size) for
  checking your own work, use it freely while iterating; "video" — the
  full-quality 1080×1920 (9:16) TikTok render, takes minutes,
  confirm with the user before starting; "video-43" / "video-43-draft" —
  the 4:3 embed canvas (1440×1080, for YouTube and desktop embeds:
  feature and footage scenes put the text beside the media);
  "screens" — the App Store screenshot set; "script" — the narration as
  plain text (instant). Output lands in ~/Downloads/showcase-exports/<id>,
  named for the showcase: <id>[_43][_draft].mp4, <id>_script.txt, and
  screens/ (numbered scene PNGs). A new export takes the plain name and
  moves older ones to history/ there, numbered (history/<id>_draft.1.mp4,
  history/screens.1/). One
  export runs at a time — the user's Export button in the studio shares
  the same queue, so an export may already be running when you start one. (The repo's npm export scripts only cover the showcases bundled
  in the app repo — for this folder, use the MCP tools.)
- Full-quality videos ("video", "video-43") need a subscription once
  this computer's 2 free ones are used; drafts, "screens" and "script"
  are always free. studio_info's license says where the user stands:
  state "trial" with freeLeft, "subscribed", "payment" (a failed card),
  or "waiting" (a checkout is open). Say so before starting a full
  export that would use up a free one. When none are left, export fails
  with a message: pass it on — the user subscribes from the studio's
  Trial button (top right), and manages the subscription under the gear.
  Never use a draft in place of the full video the user asked for.

## When another studio already has this library open
Only one studio opens a library at a time. If studio_start finds another
one running on this folder — another Claude session, most likely, or the
user's own — it starts nothing and answers {started: false, alreadyOpen,
git, next}. The other studio tools refuse the same way until you call
studio_start. Don't work on the same files as another session: the edits
collide, and each session's commits pick up the other's unfinished work.

    library in git ──► offer a worktree: a separate copy with its own studio
    not in git ─────► say where the other studio is open, and ask the user

- In git, offer a worktree: a second copy of the repository, made from
  its last commit, on its own branch, with its own studio. Say first what
  the copy won't have. git.notInGit lists showcase files git doesn't
  track, such as recordings kept out of git on purpose; their slides
  would show a missing asset. git.uncommitted lists changes not committed
  yet, perhaps the other session's work in progress.
- If the user agrees: run git.worktree.add with a name and a branch of
  your choosing, move this session into the new folder (Claude Code's
  EnterWorktree tool, with that path; or ask the user to start a new
  session there), then call studio_start with library set to
  git.worktree.library.
- Work and commit there as usual, with commit_showcase. Your commits land
  on the worktree's branch. Bringing them back is a git merge, and when
  to do it is the user's call — the other session may still be changing
  the same showcase. When you're done, tell the user the branch name.
- Not in git, a copy can't be made: tell the user where the other studio
  is open, and ask whether to stop here or run a second studio on the
  same files anyway.
- Pass studio_start alongside: true only when the user has chosen a
  second studio on the same files. After that, restarting that studio
  with other choices doesn't ask again.

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
  |                 | {field: "theme", group, name, value} from the style   |
  |                 | panel, {field: "theme.set", key, value} from          |
  |                 | edit_theme                                            |
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
- The studio also keeps an Actions list: every export, media build and
  git commit, whoever started it — a button, you, or the studio itself —
  as a record that is pending (a commit waiting out its quiet period),
  running, done, failed or canceled, with who started it and why. The
  user sees it behind the activity slot at the right of the showcase's
  top bar, where a failure stays marked until they dismiss it, and where
  they can skip a waiting commit, cancel a running job, try a failure
  again, or rebuild everything. Your own exports and builds show there
  as "Started by Claude", so the user can follow what you do. studio_info
  reports it as actions: {pending, running, failed: [...], path}; a
  failure listed there is one the user has seen. One line per state
  change goes to ${showcasesDir}/.studio/actions.jsonl (never a progress
  report), so you can follow failures the same way:

      tail -n 0 -F '${showcasesDir}/.studio/actions.jsonl' | grep --line-buffered '"state":"failed"'
- Pass ifVersion to every edit_showcase call. Get the version from
  read_showcase, or use the version your last edit_showcase returned. If
  showcase.yaml changed since then, the edit is refused, nothing is
  written, and the error lists the logged changes since your version.
  Read the showcase again, check your edits against it, and retry with
  the new version.
- edit_theme works the same way for theme.yaml: pass the themeVersion
  read_showcase returned (null when there is no theme.yaml yet — then
  leave ifVersion out), or the version your last edit_theme returned.
- Your own file-editing tool has no such check. Read the file right
  before you change it.

## History
When the library is inside a git repository, the studio can commit as
you go. studio_start and studio_info report it as \`history\`:
{git, autoCommit, enabled, available, branch, reason?}. autoCommit is
true when the studio commits on its own; enabled is the user's switch;
available is false when commits can't happen here at all (no git, no
repository, or the library is in .gitignore). reason says why, whenever
the studio isn't committing on its own.

    a studio write to <id>/  ──► ~5 s with no more changes  ──► commit of <id>/ only
    any other change in <id>/ ──► ~30 s with no more changes ──► commit of <id>/ only

- The studio's own writes start the short clock: studio edits,
  edit_showcase, edit_theme, asset changes on the Assets page, a media
  build, a saved transcript.
- A file you or the user change directly (a TSX graphic, a file in
  assets/) starts the longer one. Each further change restarts it.
  When it ends, the studio commits that showcase, and the message lists
  those files as "files changed directly".
- One showcase has one clock. A studio write and a direct change made
  close together end up in one commit.
- Changes under .studio/ and files at the library's root are never
  committed this way. Only that showcase's folder goes into a commit;
  other work in the repository is left alone, staged or not.
- In the studio Claude Code starts, the studio makes no commits on its
  own (autoCommit is false, and reason says so). Committing is your job
  there: when you finish a meaningful step, call commit_showcase. That
  matters most for files you wrote with your own tools — a graphic
  stays uncommitted until you do.
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
  when they change it. The switch turned off means "keep the studio out
  of my git": then commit_showcase commits nothing either, and if the
  user wants a checkpoint, tell them the switch is off. (That is not the
  same as the studio Claude Code starts, where only the studio's own
  commits are off and commit_showcase still works.)
- Nothing is committed while a merge, rebase, cherry-pick, revert or
  bisect is in progress, or on a detached HEAD. If \`history.git\` is
  false, the library isn't a git repository yet — the studio starts one
  the first time it saves a change, so there is nothing to do. Its
  \`reason\` says why when it won't (commits turned off, or a folder too
  big to put a repository in).
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
