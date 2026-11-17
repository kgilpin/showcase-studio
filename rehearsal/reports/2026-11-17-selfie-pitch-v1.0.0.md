# Rehearsal "v1.0.0": selfie-pitch on the 1.0.0 release candidate

Run on 2026-11-17 through the plugin against the signed and notarized
1.0.0 app (`dist-electron/dist/mac-arm64/Showcase Studio.app`, the zip
that ships). The session had no studio source to read.

What changed for a session since 0.9.0 and this scenario can show:
covers (`cover.yaml`, written with `edit_cover`) and theme edits through
the studio (`edit_theme`). The brief gained two lines in the user's
words, naming no tool: gold-on-navy captions, and a TikTok cover with
"NOVA" over a frame of the speaker. The rubric gained `edit_theme` and
`edit_cover`.

|                           | v0.9.0 (2026-11-10)                       | v1.0.0                                    |
| ------------------------- | ----------------------------------------- | ----------------------------------------- |
| Turns                     | 46                                        | 55                                        |
| Wall time                 | 5 min 25 s                                | 5 min 34 s                                |
| Cost                      | $3.46                                     | $3.70                                     |
| Studio tool calls         | 23                                        | 31                                        |
| Build, check, look cycles | 2                                         | 2                                         |
| Draft exports             | 1                                         | 1                                         |
| Outside check             | none over a face (23 captions, 12 scenes) | none over a face (23 captions, 12 scenes) |

The extra turns and calls are the two new asks: one `edit_theme`, two
`edit_cover` with a `screenshot_cover` after each, and two `ffmpeg`
calls to cut cover frames.

## Rubric

|                           |                                                                        |
| ------------------------- | ---------------------------------------------------------------------- |
| used create_showcase      | yes, 1 call                                                            |
| used check_framing        | yes, 2 calls: 4 captions over a face, then none after lifting the picture |
| used screenshot_frame     | yes, 2 calls, 13 frames, safe area shaded on all                       |
| used ffmpeg               | yes, 4 calls (the end card twice, two cover frames)                    |
| used transcribe           | yes, 4 calls                                                           |
| used edit_theme           | yes, 1 call, before the first build; no hand edit of theme.yaml        |
| used edit_cover           | yes, 2 calls, the second with `ifVersion` from the first               |
| used validate             | yes, 1 call, no warnings                                               |
| check_framing at least 2x | yes                                                                    |
| export at most 1x         | yes, 1 draft                                                           |
| build_media at most 2x    | yes, 1 call                                                            |
| no Bash sleep loops       | yes; the build and the export were waited on with `waitMs: 120000`     |

## Compared with 0.9.0

The same path for the video: create, transcribe, write the cut list,
one build, check, fix the framing, check again, look, export. The new
asks slotted in without detours: the theme before the first build, the
cover after the framing was settled. The session looked at the cover
(`screenshot_cover`) after each change and picked a second frame when
the first one caught the speaker mid-word.

## Findings

1. No blocking finding: every new capability was found from the guide
   and the tool descriptions, and used correctly.
2. The cover's picture came from an `ffmpeg` call the session wrote
   itself (a still from the take). The Cover page can pick a frame from
   the video; no tool does that for a session. Worth a tool if later
   rehearsals keep doing it by hand.

## For the rehearsal itself

The scenario still has no voiced showcase, so `meta.voiceover` work is
untested by rehearsal.
