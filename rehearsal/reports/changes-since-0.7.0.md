# What changed since v0.7.0, and what it should do for authoring

v0.7.0 was tagged on 2026-10-27. Everything below landed on main after
it. The question for each: does it change how a session makes a video,
and what should we see in a rehearsal if it works?

## Changes a rehearsal should show

| Change                                                                                                              | PR        | What a session gets                                                                                     | What to look for in the run                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `screenshot_frame`: one frame of the video at a given time, TikTok or 4:3, captions on, safe area shaded on request | #30 (#27) | A way to answer "at time T, is X right?" without a draft export and scrubbing                           | The session checks moments with `screenshot_frame` instead of rendering drafts; fewer or no draft exports before the final one                   |
| `check_framing`: captions that sit over a face, with the fix                                                        | #38       | A measurement where before there was only looking; the lift computed                                    | On a selfie take: the tool is called, the overlap is found, a lift is written, the frame is looked at, the final check is clean                  |
| `ffmpeg` tool: encode into `assets/` through a temporary file                                                       | #39 (#7)  | Clips land whole, so the page reloads once per encode, not mid-write; the write is logged and committed | Cutaways and the end-card composite are made with the tool, not a bare ffmpeg call into `assets/`; no "no moov atom" or blank clip in the player |
| `edit_showcase` describes the watermark's `inset` and `shade`                                                       | #36 (#34) | The tool's own description now matches what it accepts                                                  | Only matters if the session adds a brand mark; then it should not be refused for a field the guide names                                         |
| Code-changed banner, from source                                                                                    | #36 (#18) | A studio from source says when its server code changed under it                                         | Not an authoring change. Relevant to us while rehearsing from source: a stale studio would otherwise mislead the run                             |

## Changes that help the person, not the session

| Change                                                                    | PR        | What it does                                                                                  |
| ------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------- |
| `meta.view`: a default player view per showcase, with a pin in the player | #32 (#20) | A 4:3 showcase opens in 4:3; the Share page opens on the matching destination                 |
| Share to YouTube (4:3) beside YouTube Shorts                              | #32 (#31) | A fourth destination, taking the 4:3 export, with its own text                                |
| Tab bar collapses by its own width                                        | #35 (#33) | The bar fits beside the docked agent; status in one slot; the trial pill folded into the gear |
| Share page lays out by its own width                                      | #28       | Same kind of fix for the Share page                                                           |
| Site: the words move into `content/*.yaml`                                | —         | Marketing site only                                                                           |

## What the first rehearsal is set up to test

One scenario: nova-play-together from its raw inputs (the take, four
cutaway clips, the App Store image) and a brief in the user's words. It
exercises the first three rows of the first table in one authoring
session. The brief does not name any tool. Two runs:

1. **blind**: the guide and the tool descriptions have to carry the new
   tools to the session.
2. **hinted**: one extra line in the brief names what to check, to
   separate "didn't find it" from "doesn't help".

The grader reads the transcript, not the session's own summary: every
tool call in order, the counts, the cost, and the final message. The
outcome is then checked from outside the run: `check_framing` on the
result, and `screenshot_frame` at the moments it names.
