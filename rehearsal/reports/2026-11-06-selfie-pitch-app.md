# Rehearsal "app": selfie-pitch on the packaged app (PR #46)

Run on 2026-11-06 through the plugin against a packaged app built from
`experiment/release-rehearsal-2` (main plus the rehearsal and the four
fixes from the second report), the way the release step runs it. Same
scenario and brief as the two runs from source. The session had no
studio source to read: the plugin's launcher ran
`dist-electron/dist/mac-arm64/Showcase Studio.app --mcp`.

|                           | blind            | fixed                          | app                                       |
| ------------------------- | ---------------- | ------------------------------ | ----------------------------------------- |
| Turns                     | 67               | 62                             | 61                                        |
| Wall time                 | 8 min 22 s       | 8 min 57 s                     | 9 min 38 s                                |
| Cost                      | $5.20            | $5.96                          | $4.68                                     |
| Studio tool calls         | 29               | 32                             | 30                                        |
| Build, check, look cycles | 1                | 3                              | 2                                         |
| Draft exports             | 1                | 1                              | 2                                         |
| Outside check             | none over a face | none over a face (12 captions) | none over a face (21 captions, 11 scenes) |

## Rubric

|                           |                                                      |
| ------------------------- | ---------------------------------------------------- |
| used create_showcase      | yes, 1 call, the first thing after reading the guide |
| used check_framing        | yes, 2 calls                                         |
| used screenshot_frame     | yes, 3 calls, 12 frames, safe area shaded on all     |
| used ffmpeg               | yes, 1 call (the end-card composite)                 |
| used build_media          | yes, 2 calls                                         |
| used transcribe           | yes, 2 calls (the first with the wrong input)        |
| check_framing at least 2x | yes                                                  |
| export at most 1x         | **no**, 2 drafts                                     |
| no Bash sleep loops       | yes                                                  |

## Did the new capabilities get used from the app alone?

The question this run was for: with no source to read, do the tools
added since 0.7.0 get picked up from the guide and the tool descriptions?

| Capability                     | What the run showed                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_showcase`              | Called right after the guide, before anything else touched the library. The folder and the change log's first line come from it. The first `showcase.yaml` was then written whole with the session's own file tool, eleven scenes at once, over the scaffold.                                                    |
| `check_framing`                | Called once after the first build: 2 captions over a face, both on the end card, which at that point was still the raw take (face 43–65% down, caption 43–57%, covering 60%). The session applied the guide's end-card recipe and put the captions at 33%. Second call after the second build: none over a face. |
| `screenshot_frame`             | Six frames with the safe area shaded after the second build, four more after a fit change, two after the caption split. Every look before the draft went through it.                                                                                                                                             |
| `ffmpeg` tool                  | The end-card composite: the listing cropped to icon and title on a black stage, the speaker window bottom-right, encoded into `assets/` through the tool. The guide's recipe, followed as written: no TestFlight banner, no page clutter, which both earlier runs had.                                           |
| `waitMs`                       | On both builds and both exports, with the maximum, from the description alone. No sleep loops.                                                                                                                                                                                                                   |
| `take` through `edit_showcase` | The outro's take was rewritten through the tool (to carry `clip: false`) after the session's first attempt put `clip` on the scene and was refused. See finding 1.                                                                                                                                               |
| `export_dir`                   | The draft landed in `<run>/library/exports/nova-play-together/`. Downloads untouched.                                                                                                                                                                                                                            |
| two-line captions              | Applied to every on-camera caption from the start (captions at the top, two lines each, in the sky above the face). Not applied to the end card until the first draft showed the three-line caption touching the speaker window; then split in two and re-exported. That is the second draft.                    |

The path differed from both source runs in one way worth noting: the
session put the on-camera captions at the top (`position: top`) instead
of lifting the picture, since in this take the face sits mid-frame and
the sky above it is empty. `check_framing` agreed. Either answer is
right; the check is what made the choice safe.

## Findings

1. **`clip` is read inside `take`, but the guide said "on the scene".**
   The session wrote `clip: false` on each cutaway scene, as the guide's
   end-card recipe and the "same take on any other theme" line both
   suggested. The build ignores a scene-level `clip`, so it cut a speaker
   clip for every cutaway (four clips nobody shows, in `assets/`), and
   `edit_showcase` refused `clip` as a scene field. The session read the
   error's field list, found `take`, and sent `take: {from, to, clip:
false}`, which is the shape the build reads. Fixed in the guide: both
   places now say `clip` lives inside the take and that the build ignores
   it on the scene.
2. **`transcribe` was called with `{showcaseId, asset}`.** The tool takes
   `{file}`. Every other tool that names a recording takes a showcase id
   and an asset key, so the guess was reasonable; the error named the
   right input and the second call worked. Fixed both ways: the tool
   takes a showcase id and asset key too, and its description names its
   inputs up front, since that description is what a session calls from
   (finding 3). The guide shows the call.
3. **The tools' input schemas were not in the session's prompt.** Both
   errors above carried the note "This tool's input schema was not in
   your prompt when you called it", and the session loaded
   `edit_showcase` with ToolSearch before retrying. The plugin's tools
   are deferred in a `claude -p` session, so a session calls them from
   the names and the guide's wording. That makes the guide's call shapes
   load-bearing: when the guide names a tool, it should show its input.
4. **Two draft exports.** The first draft was looked at by cutting a
   frame out of the file with ffmpeg; the three-line end-card caption
   touched the speaker window; the session split it, looked with
   `screenshot_frame`, and exported again. The look should have come
   before the first export (the same frame was in the six it took), and
   the two-line rule should have caught it when the caption was written.
   A guide gap only in that the rule sits under caption position, not in
   the end-card recipe, where the caption is the one most likely to be
   long. Not changed: one more line there would be a third copy of the
   rule.
5. **A caption over busy screen text.** The quick-tap cutaway is a phone
   recording of a tutorial page; `tiktok: {fit: fill, focus: top}` puts
   the page's header and the caption in the same place, so "Each move is
   a quick tap" sits on the game's status bar. Not a face, so no tool
   flags it, and the session looked at that frame and passed it. A
   judgment call the rubric can't grade; worth a line in the guide about
   cutaways with text in them, if it recurs.
6. **The first `showcase.yaml` was written whole**, with the session's
   file tool, over the scaffold `create_showcase` made. The change log
   has the creation and every edit after, but not the draft itself. For
   eleven scenes at once that is the practical door; `edit_showcase` is
   for changes. The skill could say so, so a session doesn't wonder.

## Frames looked at

`verify-frame-1..6.png` in the run folder: the hook, the quick-tap
cutaway, the gentle-start cutaway, the dinner line, and the end card at
both of the times the first check flagged. The on-camera captions sit in
the sky above the face, just under TikTok's top strip; the chin is in the
description strip at the bottom, which is fine. The end card is the
recipe: icon and title top-left, the caption under them in the gap, the
speaker window bottom-right and clear of the buttons column. The quick-tap
frame is finding 5.

## For the rehearsal itself

- `run.sh` writes runs under `$TMPDIR`, which on a Mac is a
  `/var/folders/...` path, not `/tmp`. The skill now says to take the run
  folder from the line `run.sh` prints.
- The grader's "export at most 1x" line turned up a real finding (4),
  so it stays as it is.
- The app run is the one the release step should read. The two source
  runs found the gaps; this one shows the guide and the descriptions
  carrying a session with nothing else to read.

## Fixed in the same change as this report

- Finding 1: the guide says `clip` goes inside `take`, in the recorded
  pitch section and in the end-card recipe.
- Finding 2: `transcribe` takes `{showcaseId, asset}` too, the asset key the
  way the other tools name files, with `{file}` still accepted; its
  description names both up front, and the guide shows the call.
- The rehearsal skill names the run folder as `run.sh` prints it.
