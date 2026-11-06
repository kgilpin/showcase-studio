# Rehearsal run "blind": nova-play-together from its raw inputs

Run on 2026-11-05 against main as of the #38 and #39 merges, from source
through the plugin (`SHOWCASE_STUDIO_SRC`), with no tool named in the brief.

|                   |                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------ |
| Turns             | 67                                                                                   |
| Wall time         | 8 min 22 s (about 1 min of it waiting on the draft export)                           |
| Cost              | $5.20                                                                                |
| Studio tool calls | 29 of 65 tool calls                                                                  |
| Draft exports     | 1, the one the brief asked for, at the end                                           |
| Final result      | `check_framing` from outside the session: 20 captions on 11 scenes, none over a face |

## Did the new capabilities get used, and did they help?

| Capability                       | Used?                                      | What happened                                                                                                                                                                                                                               |
| -------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `check_framing`                  | Yes, unprompted, right after `build_media` | First pass: 5 captions over the face on 4 speaker scenes (6–11% covered). The session wrote the tool's suggested lift, `area: {bottom: 8%}`, on all six speaker scenes in one `edit_showcase` batch, ran the check again: none over a face. |
| `screenshot_frame`               | Yes, twice                                 | 10 frames across the video with the safe area shaded after the build, then 7 at the moments the warnings named after the fix. No draft export was rendered to check anything.                                                               |
| `ffmpeg` tool                    | Yes                                        | The end-card composite (listing + the speaker in a rounded window) was encoded through the tool into `assets/`; the result gave it the asset key and the duration.                                                                          |
| `edit_showcase` watermark fields | Not exercised                              | No brand mark in this brief.                                                                                                                                                                                                                |

The session's own recap named the face check as a step and said what it
did about it. The outside check agrees with the recap.

## How the path compares with the first time

The first cut of this showcase (2026-11-04, by hand with a session) found
the face problem by eye, measured the lift by hand (15%), and checked it
with draft exports; the showcase's notes record that. This run found it
with one tool call, fixed it with the computed value, and checked it with
frames. One draft export in the whole run, and only because the brief
asked for one.

Side by side at 2.0 s and at the end card (`runs/blind/compare-*.png`):

- Speaker scenes: both clear the face. The hand version's 15% leaves more
  room; the computed 8% is the minimum with a 3% margin, and the chin
  sits just above the caption. Worth a thought: the tool could suggest a
  rounder, roomier number.
- End card: the hand version shows only the icon and title, big, with the
  caption in the gap. The session showed the whole listing, including the
  TestFlight banner in the source image, and put the speaker window over
  it. It noticed the banner and said so. The brief said "show the App
  Store listing", and it did exactly that. A judgment call, not a tool
  gap.

## Findings about the product and the docs

1. **Whisper from source.** The session found no whisper binary, installed
   it with Homebrew, and then had to stop and restart the studio before
   `transcribe` worked. The packaged app ships the binary, so a user never
   sees this; a rehearsal from source should vendor it first (done for
   the next run). The restart itself is a real cost of the "found at
   start" lookup; a studio that looked again on each call would not need
   it.
2. **The session read the studio's source** (build-plan.mjs, timing.mjs,
   grep for how words are matched) to learn how the cut list and the word
   matching work. CLAUDE.md's own rule: a session that reads the source to
   learn a workflow is a sign the guide is missing a section. What it
   looked for: how `take` boundaries are honoured, and how caption words
   match the transcript (`normalizeWord`).
3. **Waiting on the export.** It polled `export_status` and the Downloads
   folder with `sleep` loops for a minute. The export tool could say what
   to do while it waits, or `export_status` could block for a while.
4. **Exports share one folder by showcase id.** This run's draft landed in
   `~/Downloads/showcase-exports/nova-play-together/` and moved the real
   library's draft into `history/`. Nothing lost, but a rehearsal should
   run with its own export folder.
5. **The final message in the transcript is not the recap.** A stray
   notification after the export made the session's last message "nothing
   changed"; the real recap is the message before. The grader prints the
   last long message for that reason.
6. **The face finder worked first time**, through the plugin, from a
   `claude -p` session, with no setup.

## What to change in the rehearsal before the next run

- Vendor whisper into the source worktree (done).
- Point exports at a scratch folder.
- Keep the "hinted" variant unused: discoverability was not the problem.
- Add a second scenario with a voiced showcase (Polly) and a brand mark,
  so the other changed paths get exercised.
