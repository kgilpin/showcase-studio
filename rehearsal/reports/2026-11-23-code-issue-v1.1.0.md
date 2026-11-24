# Rehearsal "v1.1.0": code-issue on the 1.1.0 release candidate

Run on 2026-11-23 through the plugin against the signed and notarized
1.1.0 app (`dist-electron/dist/mac-arm64/Showcase Studio.app`, the zip
that ships). The session had no studio source to read.

What this run tests: video templates, the guide's rules for graphics
and for titles of problems, `check_titles` and `check_script`, and
graphics that start on a named caption. The brief names no tool.

|                   | issue-84 (2026-11-22, from source)       | v1.1.0 (the app)                                         |
| ----------------- | ---------------------------------------- | -------------------------------------------------------- |
| Turns             | 46                                       | 74                                                       |
| Wall time         | 6 min 31 s                               | 9 min 19 s                                               |
| Cost              | $4.81                                    | $7.14                                                    |
| Studio tool calls | 30                                       | 47 (13 edit_showcase, 12 validate, 10 screenshot_frame)  |
| Exports           | 0                                        | 2 drafts (4:3 and TikTok)                                |
| Result            | 7 scenes, 60 s, 6 graphics, no warnings  | 7 scenes, 60 s, 6 graphics, no warnings                  |
| Outside check     | live 4:3 frames, TikTok frames           | check_framing clean; live 4:3 and TikTok frames on scene 4 |

## Rubric

| What grade.py checks       |                                                                 |
| -------------------------- | --------------------------------------------------------------- |
| used list_templates        | yes: found `code-issue` unprompted                              |
| used create_showcase       | yes, with `template: code-issue` and a view                     |
| used screenshot_frame      | yes, 10 calls, both shapes, live and finished                   |
| used check_titles          | yes, 1 call                                                     |
| used validate              | yes, 12 calls                                                   |
| export at most 1x          | NO, 2: one draft per shape. The brief asks for both, so the limit is too tight |
| build_voiceover at most 0x | yes                                                             |
| no sleep loops             | yes                                                             |

| Looked at by hand |                                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------------- |
| words             | yes: graphic labels are short, and numbers sit on the rows they count                             |
| kind              | yes: expected and actual are one diagram, labeled on the last row                                 |
| titles            | yes: "CSV import should bring in every row, but skips the last one", no count or function name    |
| timing            | yes: every graphic uses `var(--caption-<id>-start)`; no typed-in times                            |
| clear             | yes in the frames checked; check_framing found nothing                                            |

`check_script` was also used, twice, and the session rewrote the lines
it flagged.

## Compared with issue-84

Same shape of result. The extra turns and cost are `check_script`
passes, a TikTok layout redrawn after looking at the safe area, and two
draft exports to watch the timing. The session didn't read any source.

## Findings

1. **A live screenshot came back empty once.** The session says
   `screenshot_frame` with `animations: live` returned an empty picture
   for scene 4 when that frame came first in a call. It was right later
   in the same call and in both draft videos. Four tries from outside
   (4:3 and TikTok, scene 4 first) didn't reproduce it. Watch for it in
   the next rehearsal. If it comes back, look at the first paint in
   `src/lib/record-seek.ts`.
2. **The rubric's export limit doesn't fit the brief.** The brief asks
   for a video that works in 4:3 and TikTok, and one draft per shape is
   a fair way to check that. Raise `max_calls.export` to 2.
