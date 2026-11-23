# Rehearsal "issue-84": code-issue on the caption start times branch

Run on 2026-11-22 from source, on `feature/caption-start-times` (PR 86,
built on PR 82). It is the first run of this scenario. The session could
read the studio's source, and it did (see the findings).

What this run tests: the guide's rules for graphics and for titles of
problems, and graphics that start on a named caption (issue 84). The
brief names no tool and states none of the rules. The issue it starts
from is a trap: it offers counts, a function's name and "the row-flush
loop never flushes", all of which make bad titles.

|                   | issue-84                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| Turns             | 46                                                                                  |
| Wall time         | 6 min 31 s                                                                          |
| Cost              | $4.81                                                                               |
| Studio tool calls | 30 (8 validate, 8 edit_showcase, 7 screenshot_frame)                                |
| Exports           | 0                                                                                   |
| Result            | 7 scenes, 60 s, 6 graphics, no warnings                                             |
| Outside check     | 12 live 4:3 frames around caption starts, 7 TikTok frames with the safe area shaded |

## Rubric

| What grade.py checks  |                                                   |
| --------------------- | ------------------------------------------------- |
| used list_templates   | yes, 1 call: found `code-issue` unprompted        |
| used create_showcase  | yes, from the template                            |
| used screenshot_frame | yes, 7 calls, both shapes, live and finished      |
| used check_titles     | yes, 1 call, plus its own cold read by a subagent |
| used validate         | yes, 8 calls, after each round of edits           |
| export at most once   | yes, none                                         |
| no build_voiceover    | yes                                               |
| no sleep loops        | yes                                               |

The five rules, graded by hand from the YAML, the graphics and the
frames:

| Rule   | Grade  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| words  | mostly | Every graphic uses labels: "✓ row", "✕ dropped", "should be a row", "still in buffer". Each number sits on what it counts ("1,241 transactions", "1,240 imported"). Two labels echo their caption: "never parsed" under "…never gets parsed", and "imported · no error" under "…imported as 1,240, with no error".                                                                                                                                                                                                                                                    |
| kind   | yes    | Expected and actual are one diagram of the file's lines, with "✕ dropped / should be a row" on the last line. The cause is the real excerpt with two lines marked. The fix and the tests scenes put two small cases next to each other. Those are diagrams with three-word labels, not panels of text.                                                                                                                                                                                                                                                                |
| titles | partly | The opening title follows the rule: "Tallybook's CSV import should bring in every row, but drops the last one". So does the expected scene's: "Each line should become a row, but one without a newline doesn't". The trap phrases ("readRows", "row-flush loop") stayed out of every title. But the symptom scene's title is "A file with 1,241 transactions imports as 1,240, with no error": the counts are in the title, though the template asks for "What should happen, and what happens instead" there. The first caption says the problem, as the rule asks. |
| timing | yes    | All six graphics use `var(--caption-<id>-start)`, with no typed-in times. In every scene the later part is hidden 0.3 s before its caption starts and on screen 0.7 s after.                                                                                                                                                                                                                                                                                                                                                                                          |
| clear  | yes    | No caption covers a graphic in 4:3 or in TikTok. Every graphic and caption stays clear of TikTok's tabs, buttons and description.                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Compared with earlier runs

This is the first run of the scenario. Against the selfie-pitch runs, the
session spent more of its calls on looking: 7 frame calls against 2,
and it took frames just before and after caption starts without being
told to. That check comes from the guide's timing rule, which says to
do it.

## Findings

1. **The guide doesn't say how large a graphic is drawn.** The session
   read `SceneView.tsx`, `EmbedSceneView.tsx` and `SceneMedia.tsx` to
   find the box a console graphic gets in 4:3 and in TikTok. A user's
   session can't do that. Add a line to "Drawing a graphic": the box's
   shape in each view, and that sizes in `cqw`/`cqh` follow it.
2. **A count went into a problem's title anyway.** The template and the
   guide both say what the symptom title should be, and `check_titles`
   ran, but its reader judged whether the titles tell the story, not
   whether they follow the rule. Consider having `validate` warn on a
   number in a scene title, or giving `check_titles` the rule to check.
3. **One title repeats its first caption word for word** ("The tests
   pass because every test file ends in a newline"). No rule forbids
   it. It wastes the title, so the guide could say a title and the
   first caption should not be the same sentence.
4. **The session also grepped the source for `captionStarts`.** It
   wanted to confirm the variables exist. The guide's timing section
   shows the CSS, so this is doubt rather than a gap. Running from the
   packaged app would remove the option.

## Changes to the rehearsal

- `scripts/rehearsal/verify.sh` has the showcase id `nova-play-together`
  typed in, so it can't check this scenario. It should take the id as an
  argument, or read it from the scenario. This run was checked with
  `screenshot_frame` on a separate studio instead.
- `verify.sh` takes finished frames only. For this scenario it should
  also take live 4:3 frames just before and after each named caption's
  start, which it can find from the record page.
- Run it next from the packaged app, so the session can't read the
  source.
