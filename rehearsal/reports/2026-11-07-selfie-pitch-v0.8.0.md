# Rehearsal "v0.8.0": selfie-pitch on the 0.8.0 release candidate

Run on 2026-11-07 through the plugin against the signed and notarized
0.8.0 app (`dist-electron/dist/mac-arm64/Showcase Studio.app`, the zip
that ships), the way the release step runs it. Same scenario and brief
as the three earlier runs. The session had no studio source to read.

It is the third run of this release. The first ("v0.8.0-wrong-app",
2026-11-06) is not graded: the runner passed a relative `--app` path,
and the plugin's launcher fell back to the installed 0.7.0 app without
saying so (issue #53, and the runner now refuses a missing app). The
second ("v0.8.0-build1", 2026-11-06) ran on the first 0.8.0 build and
found one bug, fixed before this run: the automatic build put a failed
"No showcase named exports" record in the Actions list every time the
draft export landed in the library's `exports/` folder.

|                           | app (2026-11-06, PR #46)                  | v0.8.0-build1                             | v0.8.0                                    |
| ------------------------- | ----------------------------------------- | ----------------------------------------- | ----------------------------------------- |
| Turns                     | 61                                        | 52                                        | 57                                        |
| Wall time                 | 9 min 38 s                                | 8 min 41 s                                | 7 min 46 s                                |
| Cost                      | $4.68                                     | $4.74                                     | $4.46                                     |
| Studio tool calls         | 30                                        | 28                                        | 30                                        |
| Build, check, look cycles | 2                                         | 2                                         | 3                                         |
| Draft exports             | 2                                         | 1                                         | 1                                         |
| Outside check             | none over a face (21 captions, 11 scenes) | none over a face (21 captions, 11 scenes) | none over a face (21 captions, 11 scenes) |

## Rubric

|                           |                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------- |
| used create_showcase      | yes, 1 call, right after reading the guide                                            |
| used check_framing        | yes, 3 calls                                                                          |
| used screenshot_frame     | yes, 2 calls, 11 frames, safe area shaded on all                                      |
| used ffmpeg               | yes, 3 calls (the end-card composite, re-cut twice)                                   |
| used transcribe           | yes, 2 calls (the first by file path, before the asset was added)                     |
| used validate             | yes, 3 calls, no warnings on any                                                      |
| check_framing at least 2x | yes                                                                                   |
| export at most 1x         | yes, 1 draft                                                                          |
| build_media at most 2x    | **no**, 4 calls: one failed on a YAML error, one built, two built nothing (finding 1) |
| no Bash sleep loops       | yes; every wait went through `build_status` and `export_status` with `waitMs: 120000` |

## Did the capabilities added since 0.7.0 get used?

| Capability                       | What the run showed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The schema and `validate`        | The session read `.studio/showcase.schema.json` twice with a few lines of Python (every field, then the definitions) before writing a scene, and ran `validate` after each build. No warnings on any run: no field ever landed in the wrong place. The `media` block in the answer (`upToDate: true`) was how it knew a build was done.                                                                                                                                                            |
| The automatic build              | Worked as designed, and the session didn't lean on it. Its own first `showcase.yaml` didn't parse (an unquoted colon in a caption), and the automatic build reported that once, as a failed record naming the line, and then again only after the next edit. After the session's `edit_showcase` calls, the studio rebuilt on its own, twice, within seconds (the words file, then the voiceover and three clips). The session's `build_media` calls after those edits found everything unchanged. |
| `check_framing`                  | First call after the first real build: 6 captions over a face, on five on-camera scenes and the end card, each with where the face and the caption sit. The session lifted the picture 10% on every on-camera scene (`media.tiktok`) with a blurred strip under it and re-cut the end card. Second and third calls: none over a face.                                                                                                                                                              |
| `screenshot_frame`               | Eight frames across the cut after the fix, safe area shaded, then three more around the end card after a caption split. Every look before the draft went through it, and the draft was checked afterwards with a contact strip of its own.                                                                                                                                                                                                                                                         |
| `ffmpeg` tool                    | The end card: icon and title cropped from the listing on black, the speaker in a small window inside the safe area, the TestFlight cloud painted over. Three cuts of it, each one replacing the last in `assets/` without the player seeing a half-written file.                                                                                                                                                                                                                                   |
| `transcribe` by showcase and key | The second call, `{showcaseId, asset: "take-8", save: true}`, wrote the editable transcript. The session then fixed two mishearings in the transcript's `corrections` list by hand, the way the guide says to (finding 3 on the first call).                                                                                                                                                                                                                                                       |
| The Actions list                 | Twenty records: the session's builds and their results, the studio's own builds with what was out of date, the draft export, and the refused commit. No record for a folder that isn't a showcase: the `exports/` bug from the second run is gone.                                                                                                                                                                                                                                                 |
| `waitMs` on status tools         | Used on every build and the export, with the maximum. No polling.                                                                                                                                                                                                                                                                                                                                                                                                                                  |

The frames the outside check saved (`verify-frame-1..7.png` in the run
folder, one per on-camera scene and the end card) show the captions two
lines each under the chin, clear of the buttons column, and the end card
with the listing's icon and title, the caption in the gap, and the
speaker window bottom-right inside the safe area.

## Findings

1. **A session still calls `build_media` after every edit, though the
   studio has already built.** Four calls: the first failed on the
   session's own YAML error, the second was the first real build, and
   the third and fourth, each right after an `edit_showcase`, found
   every output unchanged because the automatic build had run in the
   seconds between. The result is right and the cost is two no-op
   records in the Actions list, but the plugin skill's "wait on a build
   with `build_status {waitMs}`" is read as "start one, then wait".
   Change: the guide and the skill should say that after an edit the
   studio builds on its own, and the way to wait for it is `validate`
   (its `media.upToDate`) or `build_status` on the studio's own job, not
   a new `build_media`. The same was true of the second run (3 calls).
2. **The first `showcase.yaml` was written whole with the session's own
   file tool**, eleven scenes at once over the scaffold, and didn't
   parse: a caption with an unquoted colon. The automatic build reported
   it (one failed record, the line named), the session's `build_media`
   reported it too, and the session fixed it with its file tool. Every
   later change went through `edit_showcase`. The same path as the last
   report; the schema is read first now, so the fields were right and
   only the YAML was wrong. Change: a line in the guide that a first
   draft written by file should be followed by `validate` before a
   build, or nothing: the studio caught it either way.
3. **`transcribe` was called twice on the same recording**: first by
   file path, from `raw/`, before the asset existed; then by asset key
   with `save`, after `add_asset`. A minute of whisper for nothing, as
   in the last report. Change: the guide's recorded-pitch recipe should
   put `add_asset` first and name the `{showcaseId, asset, save: true}`
   form as the one to use; the by-path form is for a file that won't be
   an asset.
4. **The plugin's launcher runs the installed app when
   `SHOWCASE_STUDIO_APP` points at nothing** (issue #53). Found by the
   first run of this release, which went against 0.7.0 with nothing in
   the transcript to say so but `studio_start`'s `version`. The runner
   now makes the path absolute and refuses a missing app; the launcher
   should refuse too.
5. **`commit_showcase` was refused**: "Commits are turned off". The
   packaged app under `--mcp` reads this Mac's own studio settings, where
   the "Commit changes to git" switch is off, so the session's commit at
   the end was refused and it said so plainly. Not a product finding; it
   is the switch doing what it says. See the rehearsal note below.

## For the rehearsal itself

- The runner now refuses a missing `--app` and makes the paths absolute
  before it enters the scratch library (`scripts/rehearsal/run.sh`).
  The grader should also print `studio_start`'s `version`, so a wrong
  app is the first line of the grade, not something to grep for.
- The rubric gained `validate` as a tool to use and `build_media` as a
  tool to use at most twice, with the reason in a comment. The second
  row failed both times; finding 1 is what it was for.
- The packaged app shares `settings.json` with the user's own app, so a
  rehearsal inherits this Mac's switches (commits off, here). The
  session reported it honestly, but a rubric row about `commit_showcase`
  would be about the Mac, not the release. Leave it out.
- The session kept its scratch frames in `/tmp/nova-frames` and
  `/tmp/nova-draft-check`, outside the run. Harmless, but the brief could
  say to keep working files inside the library's `.studio/`, so a run
  folder holds everything the run made.
