# Rehearsal "fixed": selfie-pitch on the five fixes (PR #42)

Run on 2026-11-05 from source through the plugin, on `fix/rehearsal-findings`
(main as of #38 and #39, plus the five fixes from the first report). Same
scenario and brief as the blind run; whisper vendored this time; the
scratch library's `export_dir` set.

|                           | blind (first report) | fixed                                     |
| ------------------------- | -------------------- | ----------------------------------------- |
| Turns                     | 67                   | 62                                        |
| Wall time                 | 8 min 22 s           | 8 min 57 s                                |
| Cost                      | $5.20                | $5.96                                     |
| Studio tool calls         | 29                   | 32                                        |
| Build, check, look cycles | 1                    | 3                                         |
| Draft exports             | 1                    | 1                                         |
| Outside check             | none over a face     | none over a face (12 captions, 12 scenes) |

## Rubric

|                           |              |
| ------------------------- | ------------ |
| used check_framing        | yes, 3 calls |
| used screenshot_frame     | yes, 3 calls |
| used ffmpeg               | yes, 2 calls |
| used build_media          | yes, 3 calls |
| used transcribe           | yes, 2 calls |
| check_framing at least 2x | yes          |
| export at most 1x         | yes          |
| no Bash sleep loops       | yes          |

## Did the five fixes do what they were for?

| Fix                                   | What the run showed                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `export_dir`                          | The draft landed in `<run>/library/exports/nova-play-together/`. `~/Downloads/showcase-exports/` was untouched.                                                                                                                                                                 |
| whisper looked for again after a miss | Not exercised: the binary was vendored, so `transcribe` worked first time and no restart was needed. The detour from the first run is gone for that reason.                                                                                                                     |
| `waitMs` on the status tools          | Used on every build and the export, with the maximum, from the tool description alone. No sleep loops anywhere in the run.                                                                                                                                                      |
| a roomier lift                        | The first pass found 5 captions over the face, covering 10–36% (this run's captions are whole sentences, three and four lines, so they reach higher). The session chose 15% on every speaker scene, found one scene still over (8%), and went to 20%. Clean on the third check. |
| the guide's cut and matching rules    | The session still read `timing.mjs` and `build-plan.mjs`. See findings.                                                                                                                                                                                                         |

## Findings

1. **`take` is not an editable scene field.** The session split a scene
   at a pause and tried to retime its `take` through `edit_showcase`,
   which refused ("take is not an editable scene field"). It read the
   file, wrote the take with its editing tool, and sent the rest of the
   batch again. On a recorded pitch the cut list is the thing an author
   adjusts most. `take` belongs in the whitelist, with the span shapes
   `build-plan.mjs` reads.
2. **Sessions run from source read the source**, whatever the guide says.
   This one grepped for picture-in-picture handling, read `build-plan.mjs`
   for how clips are named, `studio-server.mjs` for how a showcase folder
   is created, `timing.mjs` for the word matching, and the repo's own
   example showcases for `take` and composite examples. The guide now
   covers the cut and the matching, and the session read the guide
   first; it went to the source anyway, because it could. The packaged
   app has no source, so the release step runs the app. A rehearsal from
   source measures a different session than a user gets.
3. **No tool creates a showcase folder.** The session wrote the first
   `showcase.yaml` with a shell heredoc and made `assets/` by hand. That
   is what the skill tells it not to do for edits, and there is no tool
   for the creation step; `studio_start {new: true}` opens the page for a
   person. A `create_showcase {id, title}` tool, or `edit_showcase` on a
   folder that doesn't exist yet, would close the gap.
4. **The scratch library sat in an ignored folder of the repository**, so
   the studio kept no history and `commit_showcase` did nothing; the
   session said so. Runs now default to `$TMPDIR/showcase-rehearsal/`,
   outside the repository.
5. **Whole-sentence captions.** This run kept each sentence as one
   caption, so several wrap to three or four lines and the lift had to be
   20% to clear them. The first run split long captions in two and needed
   8%. The guide's "split long captions" advice exists for the hook in
   the hand-made showcase's notes, not in the guide itself. Worth a line
   under caption rules: two lines at most in the TikTok frame.
6. **The end card, again.** Whole listing, TestFlight banner, the speaker
   window over the listing's text, the captions over the previews. Both
   runs read "show the App Store listing" literally. If the icon-and-title
   crop is the house style, the guide's CTA recipe should say so; the
   brief shouldn't have to.
7. **Transcript corrections edited with perl**, twice, to respell
   "NovaGame.com" and then drop a trailing period. Worked, but a
   `transcribe` correction input, or `edit_showcase` reaching the
   transcript's corrections list, would be the proper door.

## Frames looked at

`verify-frame-1..4.png` in the run folder: the hook, "so I created Nova",
"Nova doesn't have the stuff we hate", and the end card. Every speaker
caption sits on the chest with the chin clear; the four-line caption on
the no-junk scene reaches the collar. The end card is as described above.

## For the rehearsal itself

- Runs outside the repository (done).
- A packaged-app run before this is used as the release gate, so the
  session has no source to read.
- A second scenario: a voiced showcase with a brand mark.
- The grader could flag reads of the studio's source as a finding on its
  own, when `--source` is used.

## Fixed in the same change as this report

- Finding 1: `take` is an `edit_showcase` scene field now, checked with
  the build's own reader (`takeProblem` in `build-plan.mjs`); the tool
  description and the guide say to retime with it and then build.
- Finding 3: a `create_showcase` tool, the studio's own + card scaffold,
  logged to the change log; the skill and the guide say to start a
  showcase with it. The rubric expects it.
- Finding 5: the guide's caption-position rule says two lines at most in
  the TikTok frame, and to split a long line at a clause.
- Finding 6: the guide's recorded-pitch section has the end-card recipe:
  the listing cropped to its icon and title, large, on a plain stage, the
  speaker window bottom-right, the caption in the gap.
- For the rehearsal: the grader lists every look at the studio's source
  when a run is from source (`run.json` records where the studio came
  from), so finding 2 shows up in the grade, not only in a reading of the
  transcript.
