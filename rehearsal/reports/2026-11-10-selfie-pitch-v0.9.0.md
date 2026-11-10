# Rehearsal "v0.9.0": selfie-pitch on the 0.9.0 release candidate

Run on 2026-11-10 through the plugin against the signed and notarized
0.9.0 app (`dist-electron/dist/mac-arm64/Showcase Studio.app`, the zip
that ships), the way the release step runs it. Same scenario and brief
as the 0.8.0 runs. The session had no studio source to read.

What changed for a session since 0.8.0 and this scenario can show: the
automatic build is what a session is now meant to rely on after an
edit (the 0.8.0 report's one open finding), and a draft export renders
from a snapshot of the showcase, so edits made while it renders can't
break it. The voiced-showcase changes (`meta.voiceover.scenes`, the AWS
profile prompt) need a voiced scenario, which this library has none
of; see "for the rehearsal itself".

|                           | v0.8.0 (2026-11-07)                       | v0.9.0                                    |
| ------------------------- | ----------------------------------------- | ----------------------------------------- |
| Turns                     | 57                                        | 46                                        |
| Wall time                 | 7 min 46 s                                | 5 min 25 s                                |
| Cost                      | $4.46                                     | $3.46                                     |
| Studio tool calls         | 30                                        | 23                                        |
| Build, check, look cycles | 3                                         | 2                                         |
| Draft exports             | 1                                         | 1                                         |
| Outside check             | none over a face (21 captions, 11 scenes) | none over a face (23 captions, 12 scenes) |

## Rubric

|                           |                                                                            |
| ------------------------- | -------------------------------------------------------------------------- |
| used create_showcase      | yes, 1 call, right after reading the guide                                 |
| used check_framing        | yes, 3 calls                                                               |
| used screenshot_frame     | yes, 2 calls, 18 frames, safe area shaded on all                           |
| used ffmpeg               | yes, 1 call (the end-card composite)                                       |
| used transcribe           | yes, 4 calls (finding 2)                                                   |
| used validate             | yes, 2 calls, no warnings on either                                        |
| check_framing at least 2x | yes                                                                        |
| export at most 1x         | yes, 1 draft                                                               |
| build_media at most 2x    | **yes**, 1 call: the first build; every later rebuild was the studio's own |
| no Bash sleep loops       | yes; the one build and the export were waited on with `waitMs: 120000`     |

Every row yes, for the first time in this scenario.

## Did the capabilities get used?

| Capability                | What the run showed                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The automatic build       | The 0.8.0 report's open finding is closed by behavior, not by words. One `build_media` for the first build; after each `edit_showcase` the session went straight to `check_framing` or `screenshot_frame`, which build first when the media is stale, and the export's own build-before-render ran once ("media was out of date before its TikTok draft export"). No guide text changed for this; the session read the same skill. |
| The snapshot export       | Not visible to the session, as designed: the draft rendered, the snapshot folder was gone afterwards, and no edit landed mid-render in this run.                                                                                                                                                                                                                                                                                   |
| The schema and `validate` | The schema read before the first scene was written; `validate` after the fix and before the report, no warnings either time.                                                                                                                                                                                                                                                                                                       |
| `check_framing`           | First call: 4 captions over a face, on three on-camera scenes. The session lifted the picture 12% on every on-camera scene. Second and third calls: none over a face.                                                                                                                                                                                                                                                              |
| `screenshot_frame`        | Ten frames after the fix, eight more after the caption and publish edits, safe area shaded on all.                                                                                                                                                                                                                                                                                                                                 |
| `ffmpeg` tool             | The end card, once: icon and title cropped from the listing, the speaker in a small window bottom-right.                                                                                                                                                                                                                                                                                                                           |
| `transcribe`              | By showcase and asset key with `save`, as the guide says, then twice by file on two short cuts of the take to settle a mishearing, and once on the exported draft, to check that every sentence survived the cut in order. Finding 2.                                                                                                                                                                                              |
| The Actions list          | Six records: the session's build, the export's build-before-render, the export. No failed record of any kind.                                                                                                                                                                                                                                                                                                                      |

The frames the outside check saved (`verify-frame-1..7.png` in the run
folder) show the captions two lines each under the chin, clear of the
buttons column, and the end card with the listing's icon and title,
the caption under them, and the speaker window bottom-right inside the
safe area.

## Findings

1. **The session found the bundled ffmpeg by reaching into the app
   bundle.** For its probes, `silencedetect`, a frame strip and two
   audio cuts it ran
   `Showcase Studio.app/Contents/Resources/app/node_modules/ffmpeg-static/ffmpeg`
   by path. The guide says the binary's path is in
   `$SHOWCASE_STUDIO_FFMPEG`, but that variable is set only in the
   terminals the studio opens, not in a plugin session, so the session
   went looking. Read-only use, right result, wrong way to learn it.
   Change: `studio_info` (or `studio_start`'s answer) should name the
   ffmpeg path, and the guide should point there when the variable is
   unset.
2. **`transcribe` on the exported draft is a good check and a new
   use.** Four `transcribe` calls looks like waste; it wasn't. One was
   the recording with `save`, two were short cuts to decide between
   "starts up" and "starts out", and the last was the draft video
   itself, which came back with every sentence in order. The guide
   could offer that check by name: transcribe the draft to hear that
   the cut kept the words.
3. **The first `showcase.yaml` was again written whole with the
   session's own file tool**, over the scaffold, then edited through
   `edit_showcase`. It parsed this time. Same note as the last two
   reports; the schema read first keeps the fields right.
4. **The session read a Claude memory file that doesn't exist** on its
   first call (`cat ~/.claude/projects/<library>/memory/MEMORY.md`), a
   harmless miss of Claude Code's own, not the studio's. Noted so the
   first Bash error in the transcript isn't mistaken for a studio
   problem.

## For the rehearsal itself

- The voiced-showcase changes in 0.9.0 (`meta.voiceover.scenes`, the
  AWS profile prompt, `build_voiceover {only}`) have no scenario. One
  needs a brief with slides and no recording, a library whose
  `showcase_settings.yaml` names no `aws_profile` (so the prompt
  fires), and an AWS account to pay Polly for a few sentences: a
  decision for the user, not the release step.
- The rubric's `build_media` row held with no change to the guide. Keep
  it at 2 and see whether it holds again.
- `grade.py` should print `studio_start`'s `version` at the top; this
  run confirmed it by grep, as the last one did.
