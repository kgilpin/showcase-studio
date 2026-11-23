---
name: rehearsal
description: Rehearse a release candidate the way a user meets it - a fresh Claude session builds a showcase from raw inputs through the plugin, and the transcript is graded for whether the new capabilities got used and helped. Use before a release (the studio-release skill's rehearsal step), after a change to the guide or a tool description, or when asked to rehearse, dry-run or validate the authoring process.
---

# Rehearse a release candidate

A rehearsal answers one question: when a session that has never seen
this studio makes a video with it, does it reach a good result, and do
the capabilities added since the last release get used and earn their
keep? It is not a test of the code's output; `npm test` and the gold
traces do that. It is a test of the authoring process: the guide, the
tool descriptions, the tools, and the skill, as a session meets them.

```
rehearsal/scenarios/<name>/          what one run starts from
  brief.md        the user's words; names no tool
  inputs.txt      the raw files to copy in (a recording, clips, a picture)
  settings.yaml   the scratch library's settings (exports stay in the run)
  rubric.yaml     what a good run uses and avoids
scripts/rehearsal/
  run.sh          one run: claude -p, the plugin, a scratch library
  follow.py       one line per studio tool call while a run goes
  grade.py        the timeline, the counts, the rubric, the real recap
  verify.sh       the result checked from outside the session
rehearsal/reports/<date>-<scenario>-<run>.md     what was found
$TMPDIR/showcase-rehearsal/<scenario>/<run>/     the runs themselves
```

## 1. Decide what the run should show

Read the commits since the last tag (`git log --no-merges v<last>..HEAD`)
and sort them: changes to how a session makes a video (a tool, a guide
section, a skill step) against changes a person sees in the studio. The
first list is what the rehearsal has to exercise. Add each to the
scenario's `rubric.yaml` as a tool it should use or a thing it should
not do, with a comment saying why. If no scenario triggers a change (a
voiced showcase, a brand mark), write one: a brief in the user's words,
the raw files it needs, the rubric.

Three rules keep a rehearsal honest:

- **Raw inputs only.** No showcase.yaml, no transcript, no clips. A
  committed showcase carries last time's fixes and shows nothing.
- **The brief names no tool.** The guide and the tool descriptions have
  to carry a session to the right tool. If they don't, that is the
  finding, and a cheap one to fix. Only after a blind run, a second run
  with one hint separates "can't find it" from "doesn't help".
- **Grade the record, not the recap.** The transcript shows the calls,
  the change log shows the edits, and `verify.sh` shows the result. The
  session's closing message is the last thing to trust.

## 2. Run it

From the repo root, with the raw files in a folder (`--inputs`) and the
studio under test either from a checkout or the packaged app:

```sh
# from source: the checkout needs npm i done and whisper vendored
# (electron/vendor/whisper/whisper-cli — npm run vendor:whisper)
scripts/rehearsal/run.sh selfie-pitch <run-name> \
  --inputs <folder with the raw files> --source "$PWD"

# the release candidate as a user runs it (the release skill's step)
scripts/rehearsal/run.sh selfie-pitch <run-name> \
  --inputs <folder> --app "dist-electron/dist/mac-arm64/Showcase Studio.app"
```

`SHOWCASE_STUDIO_NODE` must point at a Node 22 binary when the session's
PATH may not (Volta: `volta which node`). A run takes 5 to 15 minutes
and a few dollars; it runs `claude -p` with permissions skipped, inside
the scratch library, so start it in the background and follow it:

```sh
python3 scripts/rehearsal/follow.py "$TMPDIR/showcase-rehearsal/selfie-pitch/<run-name>/transcript.jsonl"
```

One line per studio tool call and every error, then the final result
line. Take the run folder from the first line `run.sh` prints: on a Mac
`$TMPDIR` is a `/var/folders/...` path, so a `/tmp/showcase-rehearsal`
path written by hand watches nothing. The run folder is outside the repository on purpose: inside it, the
scratch library would sit in an ignored folder, so the studio could keep
no history there, and a session run from source could browse the
scenarios. (From source the session can read the studio's code and the
repo's example showcases either way; the packaged app has neither, which
is one reason the release step runs the app.) Watch for the rubric's tools as they happen; a session that stalls
on something (a missing binary, a page that won't load) shows it here
first.

## 3. Grade it

```sh
python3 scripts/rehearsal/grade.py "$TMPDIR/showcase-rehearsal/selfie-pitch/<run-name>"
```

The timeline of every tool call, the counts, the cost, the rubric as a
yes/no table, and the session's last long message. Then the result from
outside the session, with a studio of your own on the run's library
(`npm run dev -- --library <run>/library --no-terminal --no-auto-commit`
on a free `PORT`, then):

```sh
scripts/rehearsal/verify.sh <port> "$TMPDIR/showcase-rehearsal/selfie-pitch/<run-name>" <ms> [<ms>...]
```

It finds the showcase the session made, runs `check_framing` on it and
saves TikTok frames, safe area shaded, at the times given (the ones a
warning named, or one per speaker scene). Look at them. A frame the
session never looked at is the one to look at.

For graphics timed to captions (the code-issue scenario), add
`--view 43 --live` and give times just before and just after each
named caption starts. The part that belongs to that caption should be
missing in the first frame and on screen in the second.

## 4. Write the report

`rehearsal/reports/<date>-<scenario>-<run-name>.md`, the shape of the
first one (`2026-11-05-selfie-pitch-blind.md`):

1. The numbers: turns, time, cost, studio calls, draft exports, the
   outside check.
2. One row per capability in the rubric: used, when, and what happened.
3. How the path compares with the last report of the same scenario.
4. Findings about the product and the docs, each one sentence of what
   happened and one of what to change. A session that read the studio's
   source to learn a workflow is a guide gap. A session that polled with
   sleeps is a tool gap. A wrong judgment with the right tools is a
   brief or guide gap, or nothing.
5. What to change in the rehearsal itself.

A "NO" in the rubric table is not a failed release by itself. It is a
finding to explain: the fix may be a line in the guide, a sentence in a
tool description, or a real bug. The release skill reads the report and
decides.

## What a rehearsal is not

- Not a measure of output bytes. The build is deterministic; `npm test`
  covers it.
- Not a replacement for looking. The frames `verify.sh` saves are there
  to be looked at.
- Not cheap enough for every PR. Before a release, and after a change to
  the guide, a tool description or the skill.
