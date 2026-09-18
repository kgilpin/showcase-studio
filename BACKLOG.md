# Showcase Studio backlog

Features and fixes found on 2026-09-15, while updating the `showcase-studio`
showcase for the plugin pitch. The studio ran as the installed app (0.1.1)
through the Claude Code plugin, inside Claude Code Desktop. Items 16-18 were
found on 2026-09-16, running the studio from source through the plugin.

## At a glance

| # | Item | Kind | Status |
|---|------|------|--------|
| 1 | Renaming an asset rewrites references to other assets | Fix | Original case not reproduced; a related shared-name bug fixed |
| 2 | Claude can't see edits made in the studio UI | Feature | Done (`bed6200`) |
| 3 | The preview button opens the wrong showcase | Fix | Replaced by `47bc44f`: libraries get no `launch.json`; Claude opens the preview itself |
| 4 | The preview button can't launch the installed app | Fix | Done: the app honors `PORT` and takes `--no-window` (the preview button no longer needs it) |
| 5 | Audio and JSON files are served with the wrong type | Fix | Done |
| 6 | No warning when image media points at a video file | Fix | Done: linter warning |
| 7 | Audio is silent on the Assets page | Fix | Not confirmed |
| 8 | The player's muted start is easy to miss | Fix | Done (`81f05d7`); the prompt partly covers the scene timeline labels |
| 9 | The studio commits every change to git | Feature | Done (`bda14c7`, switch in `1c7f10b`) |
| 10 | Built-in synthesized voiceover | Feature | Idea (done by hand this time) |
| 11 | Fix misheard words using the captions | Feature | Idea |
| 12 | Time graphic animations to the narration | Feature | Idea |
| 13 | Paste an image to add it as an asset | Feature | Done (`f0ac154`) |
| 14 | Claude's tools use the studio the preview button started | Feature | Not needed: one studio since `47bc44f` |
| 15 | README still describes the built-in terminal | Docs | Done (`cfd0f67`); install commands not yet tried end to end |
| 16 | A page crash only shows "This page didn't load" | Fix | Done |
| 17 | Gold traces for the studio server tests are stale | Chore | Done (see the gold-traces refresh commit) |
| 18 | The settings tooltip opens by itself | Fix | Done (`26f9fc4`) |
| 19 | The shared prompter shows "No media" on every slide | Fix | Column hidden on the shared page; sending stills (B) and colors (C) open |

---

## Fixes

### 1. Renaming an asset rewrites references to other assets

**What happened.** The user renamed `assets/showcase-studio-take-2.mp4` to
`video-readthrough-13sec.mp4` on the Assets page. Afterwards, two scenes
(`plugin` and `tools`) pointed at the renamed video. Neither scene had used
the take: both used `shot-claude-desktop`, which did not exist yet at the time.

Both scenes still had `kind: image`, so they showed a broken image.

**Expected.** A rename changes only references to the renamed file, whether
by bare key or by full file name.

**Where to look.** The rename code behind the Assets page, which "updates
every YAML reference". Check whether references to a *missing* asset get
matched by mistake.

**Test.** Two scenes: one uses a missing asset, one uses the asset being
renamed. After the rename, only the second scene changes.

**Status (2026-09-16).** Not reproduced. The rename code only rewrites a
whole `asset:`, `src:` or `cover:` value that equals the old name, and the
test above passes. Nothing else on the page rewrites references. If it
happens again, the change log (`.studio/changes.jsonl`) now records every
rename with each reference it rewrote, and the automatic git commits show
the exact change.

Looking for it turned up a real bug of the same kind, now fixed. When two
files share a bare name, the bare name means the first of them, but a
rename ignored that:

| Assets | Rename | Before the fix | Now |
|---|---|---|---|
| `shot.mp4`, `shot.png`; scene says `asset: shot` (the video) | `shot.png` → `still.png` | `asset: shot` → `still` (now the image) | left alone |
| `shot.mp4`, `shot.png`, `clip.png` | `shot.mp4` → `clip.mp4` | `asset: shot` → `clip` (means `clip.png`) | → `clip.mp4` |

### 3. The preview button opens the wrong showcase

**What happened.** Two Claude Code Desktop sessions both ran in
`appland/showcases`. That folder's `.claude/launch.json` had a single entry,
hard-wired to `--open …/gold-traces`. Pressing the preview button in the
`showcase-studio` session started or opened Gold Traces every time.

```
appland/showcases/.claude/launch.json   ← one entry → gold-traces
        ▲                    ▲
  Gold Traces session    other session  ── both get Gold Traces
```

**Why.** Claude Code reads `.claude/launch.json` from the folder a session runs
in. It doesn't know which showcase the session opened.

**Fix.**
- Give each showcase folder its own `.claude/launch.json`, for example
  `<showcase>/.claude/launch.json` with `--open <this folder>`. A session
  started in that folder then previews that showcase.
- Have the studio write the file when it creates a showcase (the way it
  writes `.studio/GUIDE.md`), or have the plugin skill write it on
  `studio_start`. Users shouldn't write it by hand.
- At the library root, list one entry per showcase as a fallback.

A from-source entry that works today:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "studio",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["--prefix", "/Users/kgilpin/source/kgilpin/showcase-studio",
                      "run", "dev", "--", "--open", "<this showcase folder>", "--no-terminal"],
      "port": 8080,
      "autoPort": true
    }
  ]
}
```

`8080` is only the first port to try. With `autoPort: true`, Claude Code picks
a free port when it's taken and passes it to the studio in `PORT`.

### 4. The preview button can't launch the installed app

Plugin users have the app, not the source, so their `launch.json` has to run
the app. Two things stop that today:

| Problem | Where | Fix |
|---|---|---|
| The app picks its own free port and ignores `PORT` | `electron/main.mjs:164` (`listen(0, …)`) | Listen on `PORT` when it's set; keep picking a free port otherwise |
| Outside `--mcp`, `--open` opens a desktop window | `electron/main.mjs` | Add a no-window option for `--open`, so the studio shows in the preview pane |

Nothing here needs a fixed port. The launcher chooses the port; the app just
has to accept it.

```
preview button ──PORT=52011──► app --open <folder> --no-window ──► pane opens :52011
```

### 5. Audio and JSON files are served with the wrong type

`server/showcase-data.mjs` has a `MIME` map with no entry for `.m4a` or
`.json`. Both come back as `application/octet-stream`:

```
voiceover-synth.m4a:        200 application/octet-stream
voiceover-synth.words.json: 200 application/octet-stream
```

Playback still worked in Chrome, which guesses the type. Add at least `.m4a`
(`audio/mp4`), `.json` (`application/json`), `.wav`, `.aac`, `.mov`, and `.m4v`.

### 6. No warning when image media points at a video file

A scene with `media: {kind: image, asset: video-readthrough-13sec}` (an
`.mp4`) passed `validate` with no warnings and rendered a broken image. The
linter should warn when the media kind and the file type don't match.

### 7. Audio is silent on the Assets page (not confirmed)

The user heard nothing from the audio player on the Assets page. Its native
player showed the muted icon. The page uses a plain `<audio controls>`
(`src/routes/showcase.$showcaseId.assets.tsx:305`), with no `muted`.

Next step: check whether the Claude Code Desktop preview pane mutes sound.
Open the same page in Chrome and compare.

### 8. The player's muted start is easy to miss

The player starts with the soundtrack muted, which is normal for browsers. The
user expected sound and heard none. Make the muted state obvious, for
example a visible "Tap to unmute" prompt while a synced voiceover is set.

---

## Features

### 2. Claude can see edits made in the studio UI

**Problem.** A person editing in the studio and Claude editing through MCP
don't see each other's changes. The file watcher skips the studio's own
writes, and UI edits count as the studio's own writes
(`server/studio-server.mjs:559`). So no event fires for them, and the
`reload` event doesn't say what changed anyway.

This caused a real mistake: Claude blamed the slide renderer for a broken
image, when a UI rename (item 1) had changed the reference.

**Plan** (the task running in worktree `hungry-shtern-aa7381`):
- The studio appends every edit it makes to `.studio/changes.jsonl`, one JSON
  line per edit: time, source (`ui` or `mcp`), showcase, and the edit itself.
  Renames list every reference they rewrote.
- Claude watches that file with `tail -F` through its Monitor tool.
- `edit_showcase` accepts `ifVersion` and refuses to write when the file
  changed since Claude last read it, listing the UI edits in between.
- Update the guide and the plugin skill to use both.

### 9. The studio commits every change to git

The updated video says: "The studio commits every change to git. Review a
change, revert it, or branch a new cut." Today the studio never commits. Its
generated README tells users to run `git init` and commit themselves
(`server/studio-server.mjs:76`).

**Build this before publishing the video**, or change that scene. Questions to
settle:
- One commit per edit, or grouped (for example, one per quiet period)?
- Commit messages from the change log in item 2 ("tools: media.asset →
  shot-claude-desktop").
- What happens when the folder isn't a git repo, or has other uncommitted work?

**Status: done** (`server/showcase-history.mjs`, commit `bda14c7`).
How those questions were settled:

| Question | Answer |
|---|---|
| One commit per edit, or grouped? | Grouped: one commit per showcase after 5 s with no more changes. |
| Messages | Subject from the change log (`nova: edit intro caption 1 text, point hook at shot-2`); files with no log entry are named. The body says who made each change. Trailer `Showcase-Studio: auto-commit`. |
| Not a git repo | Never commits and never runs `git init`. `studio_info` and `studio_start` report `history.git: false`; the skill offers `git init`. |
| Other uncommitted work | Only the showcase folder is committed (`git commit -- <folder>`); other staged work stays staged. |
| Git busy | Skips during a merge, rebase, cherry-pick, revert or bisect, on a detached HEAD, or while `index.lock` exists. |
| Naming a step | The `commit_showcase` MCP tool commits now with Claude's message. |
| Turning it off | The "Commit changes to git" switch under the gear button in the tab bar (`1c7f10b`). It is disabled, with the reason in a tooltip, when the library isn't in a git repository. |

### 10. Built-in synthesized voiceover

This session built a synced voiceover by hand. It would make a good tool
(for example `synthesize_voiceover {showcaseId, provider, voice}`):

```
captions ──TTS──► one clip per caption ──► place with pauses ──► assets/voiceover-synth.m4a
                        │                                              │
                        └─ clip lengths ──► pin caption durationMs      └─ transcribe ──► .words.json
```

What the hand-built version did:
- AWS Polly, generative engine, voice Matthew, one MP3 clip per caption.
- Each caption's window: 250 ms lead + spoken length + 450 ms tail. The last
  caption holds 1.5 s more for the end card.
- Pinned every `durationMs` to its window; the windows summed to the audio's
  length (60,732 ms).
- Set `soundtrack: {src: voiceover-synth, volume: 1, sync: true}`.
- Transcribed the result and saved `voiceover-synth.words.json` for karaoke
  captions.

Needs: a provider choice (Polly, macOS `say`, local models), credentials from
the user's own environment, and a re-run after any caption edit.

### 11. Fix misheard words using the captions

When the voiceover is made from the captions, the captions are the exact text.
The transcript still got words wrong, and they had to be fixed by hand:

| Heard | Said |
|---|---|
| Cloud Code | Claude Code |
| playing files | plain files |
| to get | to git |
| OneScript | One script |
| caption screenshots | captioned screenshots |

`transcribe` could take the expected captions and line the words up with them,
keeping the timings and using the caption's spelling.

### 12. Time graphic animations to the narration

The `showcase-command` graphic's animation delays were tuned by hand to match
the voiceover ("Type /showcase" while it types, the pane opening on "the
studio opens"). Every re-record means tuning them again.

Idea: expose the scene's word timings to graphics, for example as CSS
variables (`--word-3-start: 1.9s`), so a graphic can say "open the pane when
word 6 is spoken".

### 13. Paste an image to add it as an asset

The user pasted a screenshot into the Claude chat. Claude couldn't save it: the
image never reaches a file Claude can read, so the user had to save it into
`assets/` by hand. The Assets page already accepts drag-and-drop. Accept paste
too (Cmd+V on the Assets page).

### 14. Claude's tools use the studio the preview button started

With per-showcase `launch.json` (item 3), a session runs two studios on the
same files: the one the preview button starts (what the user sees) and the one
`studio_start` starts (what Claude's tools use). Both reload on file changes,
so it works, but it's wasteful and confusing. Let the tools connect to the
already-running studio instead.

---

## Docs

### 15. README still describes the built-in terminal

`README.md` says "Claude Code is built in. Each showcase gets a persistent
terminal…". In plugin mode the terminals are off, and the main story is now
the Claude Code plugin in Claude Code Desktop. Lead with the plugin, and
explain how to install it.

---

## Found 2026-09-16

### 16. A page crash only shows "This page didn't load"

**What happened.** Run from source through the plugin, every studio page
answered 500 with the generic error page. The real error
(`Cannot find module '@/content/showcases'`) went only to the MCP server's
stderr, which Claude Code doesn't show. Finding it took a separate test
studio. (The cause, `process.cwd()` in `vite.config.ts`, is fixed in
`d831cc8`.)

```
page request ──► SSR throws ──► src/start.ts: console.error ──► MCP stderr (hidden)
                                        └──► "This page didn't load"   (no detail)
```

**Idea.** Keep the last server-side page error and show it where someone
can act on it: in `studio_info` / `studio_start` (e.g. `lastPageError`), and
in `validate`'s "did not finish loading" message. On localhost, the error
page itself could show the message too.

### 17. Gold traces for the studio server tests are stale

Since `bda14c7`, every studio creates the history module, the scene-edit and
`edit_showcase` paths start its commit timer, and `studio_info` runs git. All
five gold traces from `server/studio-server.test.mjs` will differ from the
committed baseline. Re-record, check the differences are only these, and
bless them.

### 18. The settings tooltip opens by itself

Opening "Studio settings" (the gear button) moves keyboard focus to the
"Commit changes to git" switch, and focus opens its tooltip. So the tooltip
covers part of the page every time the panel opens. Show it on hover, or on
keyboard focus only (`:focus-visible`).

### 19. The shared prompter shows "No media" on every slide

**What happened.** The Gold Traces script, published to the Dev prompter
site (`d14fbyq2rpxth5.cloudfront.net/p/…`) and opened on a laptop, showed an
empty "No media" box beside every slide. On a phone the box doesn't show.

**Why.** The snapshot is narration only, by design (`e42e654`, "Share the
teleprompter to a phone"): no media, no theme, no assets. The page then
fills in made-up values for what wasn't sent, and hands them to the studio's
own `ScriptPlayer`:

```
showcase.yaml ──► snapshot: narration + timings    (server/prompter-script.mjs)
                        │
                  /p/<token> ──► toScenes() adds media: none, theme: statement
                                        │          (web/prompter/PrompterApp.tsx)
                                  ScriptPlayer believes it: "No media"
```

`ScriptPlayer` can't tell "this scene has no media" from "media wasn't sent".
That made-up value is the real defect; the label is one symptom.

| Screen | Media column | What shows |
|---|---|---|
| Phone (below 640px) | Hidden | Fine |
| Tablet, phone turned sideways, laptop | Shown | "No media" on every slide |

A tablet is a common teleprompter, so this isn't a laptop-only case.

**What the shared page lacks compared to the studio's prompter.**

- **The picture.** In the studio, the scene's media beside each line shows
  the narrator what the viewer is seeing ("Here's that security fix,
  recorded"). The shared page never has it, on any screen.
- **The showcase's colors.** The page uses the default blue theme, because
  no theme is sent.

**Limits.** The publish endpoint (`cdk/lambda/publish.mjs`) takes one JSON
document of at most 512 KB and writes only `scripts/<token>.json`. Anything
beyond JSON needs the endpoint and the stack changed, not just the page.

**Options.**

| Option | What the narrator gets | Work |
|---|---|---|
| A. Say "not sent", and hide the column | A clean page, no pictures | Small. See status below. |
| B. Send a still of each scene | The picture beside each line on tablets and laptops; maybe a small thumbnail on phones | Medium: at publish, capture each scene's still (the screenshot page already shows a scene at its end) and upload them. The endpoint must accept images, or hand out upload URLs; deploy the stack. |
| C. Send the showcase's colors | The showcase's own look | Small: the theme's colors are a fixed whitelist and fit in the JSON. |

**Privacy (B).** Stills put the scenes' pictures — often app screenshots —
behind the same link as the script. Anyone with the link can see them for up
to 30 days (the bucket's lifecycle). Today the link shows only words.

**Status (2026-09-16).** The column is hidden on the shared page:
`ScriptPlayer` takes `showMedia`, and `PrompterApp` passes `false`, with a
comment that its `media: none` means "not sent". The made-up value itself is
still there; a later change could drop it so `ScriptPlayer` sees media as
missing. B and C are open.

**Deploying.** The site deploy needs the publish key (`PROMPTER_PUBLISH_KEY`)
in the command; see `CLAUDE.md`. Deploy both the Dev and Prod sites.
