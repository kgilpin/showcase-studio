# Rehearsal "v1.1.0": selfie-pitch on the 1.1.0 release candidate

Run on 2026-11-23 through the plugin against the signed and notarized
1.1.0 app (`dist-electron/dist/mac-arm64/Showcase Studio.app`, the zip
that ships). The session had no studio source to read. Same brief and
raw files as v1.0.0.

What changed for a session since 1.0.0 that this scenario can show:
video templates (`list_templates`, `create_showcase` with a template),
transcription as a job (`transcribe` with `transcribe_status`), and
the outline-first step, which a fully planned brief like this one
should get past.

|                           | v1.0.0 (2026-11-17)                       | v1.1.0                                    |
| ------------------------- | ----------------------------------------- | ----------------------------------------- |
| Turns                     | 55                                        | 70                                        |
| Wall time                 | 5 min 34 s                                | 7 min 28 s                                |
| Cost                      | $3.70                                     | $4.76                                     |
| Studio tool calls         | 31                                        | 42                                        |
| Build, check, look cycles | 2                                         | 2                                         |
| Draft exports             | 1                                         | 2                                         |
| Outside check             | none over a face (23 captions, 12 scenes) | none over a face (19 captions, 12 scenes) |

## Rubric

| What grade.py checks      |                                                         |
| ------------------------- | ------------------------------------------------------- |
| used create_showcase      | yes, after `list_templates`                             |
| used check_framing        | yes, 3 calls: found 3 captions over the chin, fixed, clean |
| used screenshot_frame     | yes, 3 calls                                            |
| used ffmpeg               | yes, 4 calls                                            |
| used transcribe           | yes: one call, done within it (a 45 s take needs no job) |
| used edit_theme           | yes, 3 calls: gold on navy                              |
| used edit_cover           | yes, 3 calls, each with a `screenshot_cover` after      |
| used validate             | yes, 3 calls                                            |
| export at most 1x         | NO, 2: a second draft after the last edits              |
| build_media at most 2x    | yes, 1                                                  |
| no sleep loops            | yes                                                     |

## Compared with v1.0.0

The same path, with one more draft export and a few more turns for
`list_templates` and reading the guide's new sections. The session
skipped the outline review on its own, saying the brief gave the full
plan, which is what the guide intends for a recorded pitch.

## Findings

1. **A second draft export after the last edits.** It's a fair thing to
   do, and it cost about 40 s. Nothing to change in the product.
2. **Facts from the brief beat the transcriber.** The session fixed
   "starts up" and "NovaGame.com" from the brief, and said so. That's
   good behavior.
3. **The session wrote post text and hashtags nobody asked for.** It
   said so, and they're easy to drop. Worth a line in the guide if it
   keeps happening.

## The rehearsal itself

- Nothing to change.
