---
name: showcase
description: Open Showcase Studio on a showcase and work on it with the user — start the studio, show it, make changes, and check each one before reporting it. Use when the user wants to work on, create, or change a showcase.
argument-hint: "[showcase name | new]"
---

# Work on a showcase

The user asked for: $ARGUMENTS

Showcase Studio makes video-style product tours from a folder of files. A
library folder holds one folder per showcase: `showcase.yaml` (the
script), optional `theme.yaml` (styling), and `assets/` (screenshots and
recordings). The studio's tools come from this plugin's MCP server.

## Before you start: the app

The studio tools (`studio_start` and the rest) come from the Showcase
Studio app, which this plugin runs. When those tools aren't available,
the plugin's `showcase-studio` MCP server couldn't start, almost always
because the app isn't installed. Install it — don't try to work without
the tools:

1. Run the plugin's installer. This skill's base directory is
   `<plugin>/skills/showcase`, so the installer is `<plugin>/bin/install-app`.
   It downloads the app version this plugin expects from GitHub, checks
   its SHA-256 hash, and puts it in `~/Applications`. It needs the GitHub
   CLI (`gh`), logged in with access to the Showcase Studio repository. If
   it stops with a message, tell the user what it says.
2. The studio's tools load when a session starts, so this session still
   doesn't have them. Tell the user, in these words or close to them:

   > Showcase Studio is installed. Its tools load when a session starts,
   > so please start a new session and ask again. (Or, to stay in this
   > session: type `/mcp`, choose showcase-studio, then choose
   > Reconnect.)

   When the tools are there, continue with step 1 below.

If `studio_start` works but the `version` it returns differs from
`<plugin>/app-version`, run the installer too. It replaces the app with
the expected version. Then tell the user the same thing as in step 2.

**Running from source.** When the environment variable
`SHOWCASE_STUDIO_SRC` is set, the tools run the studio from that source
checkout instead of the app. Then skip the installer and the version
check. If the tools are missing, the server's error message says why
(a wrong path, or no Node 22). Tell the user what it says.

## 1. Start the studio

Every row here is the whole call:

| The situation                                 | The call                                                            |
| --------------------------------------------- | ------------------------------------------------------------------- |
| The user named a showcase                     | `studio_start {showcase: "nova"}`                                   |
| The user said `new`                           | `studio_start {new: true}`                                          |
| The user said nothing                         | `studio_info {}`, list its `showcases`, and ask which one           |
| Their showcases are in another folder         | `studio_start {library: "~/work/demo/showcases", showcase: "nova"}` |
| The answer was `chooseLibrary` (below)        | the same call again, with `library` set to the user's choice        |
| You have no preview panel                     | add `window: true`: the studio opens its own window                 |
| The user chose a second studio on one library | add `alongside: true` (only when they chose it)                     |

Show the studio in one place only:

- **You have a browser preview panel** (a `preview_start` tool): start
  without a window, then open the returned `open` URL with `preview_start`.
- **You don't:** pass `window: true`.
- **From source** there is no window: give the user the `open` URL.

Don't start the studio another way: no `npm run dev`, no
`.claude/launch.json` with `preview_start` `name`. Those start a second
studio the tools don't use. If the user started one with the preview's
button, stop it with `preview_stop` and open the `open` URL instead. The
studio stops when this session ends.

**Which folder.** The library is the folder the studio keeps showcases
in. By default it is the folder Claude Code runs in. `studio_start`
returns the folder in use as `library`, and says why in
`libraryReason`. Tell the user which folder it is, in full, before you
create a showcase, so they know where to find it.

**When it answers `started: false`,** nothing started. There are two
reasons, and the answer says which.

The folder Claude Code runs in holds other files, or is the home
folder, so the studio won't guess where showcases go:

```json
{
  "started": false,
  "chooseLibrary": {
    "folder": "/Users/sam/my-app",
    "why": "other files",
    "suggested": "/Users/sam/my-app/showcases"
  },
  "next": "…"
}
```

Ask the user the question in `next`, then call `studio_start` again with
their answer as `library`. A folder that doesn't exist yet is created.

Or another studio already has this library open, usually another Claude
session. You must not work on the same files:

```json
{
  "started": false,
  "alreadyOpen": { "url": "http://127.0.0.1:51734" },
  "git": {
    "root": "/Users/sam/demo",
    "worktree": { "add": "git -C /Users/sam/demo worktree add -b <branch> …" }
  },
  "next": "…"
}
```

Do what `next` says: in git, offer the user the worktree it spells out,
and say what the copy won't have (recordings git doesn't track,
uncommitted changes). Outside git, `git` is null: say where the other
studio is open and ask them what to do. The guide's "When another studio
already has this library open" has the details.

## 2. Read the guide first

`studio_start` returns `guide`: the path of the library's
`.studio/GUIDE.md`. Read that file before you open or change any showcase
file — even for a one-line change. (If you only called `studio_info`, the
guide is `.studio/GUIDE.md` in its `library` folder.)

The guide explains the format: themes, captions, media, timing, and the
recipes for recorded pitches. The studio rewrites it on every start, so it
matches the running app. Don't learn the format from other showcases or
from the app's source.

`studio_start` also returns `schema`: `.studio/showcase.schema.json`, the
fields of `showcase.yaml`, their types, and where each one goes. Read it
before you write a new showcase's scenes, and when `validate` warns that
a field isn't one or sits in the wrong place: the warning names where it
belongs, and the schema is the full list.

## 3. Make changes

- A new showcase: first call `list_templates` and ask the user to pick
  a video template, or "other", and ask where the video will go (the
  guide's "Video templates" lists the answers). For "other", also ask
  what the video is for. Then `create_showcase` with its name,
  `template`, `view`, and for "other" `purpose`. It makes the folder, a starter `showcase.yaml` and an empty
  `assets/`, and returns the id and the template's guidance. Follow the
  guidance while you write. Don't write the folder yourself.
- Then write an outline, not the slides: titles, eyebrows and a note on
  each scene, no captions or media, and what you learned from the
  repository in `meta.notes`. Open the script page in the preview, ask
  the user to review it, and stop. Build nothing until they say go
  ahead. The guide's "A new showcase: outline first" has the steps.
- A recorded or voiced showcase builds its media on its own a few
  seconds after you change the cut list, the recording, the transcript
  or the captions, and before any export or screenshot. `studio_info`'s
  `media` says whether each one is up to date; `build_media` and
  `build_voiceover` are for a forced rebuild, or for a jobId to wait on
  with `build_status {waitMs}` before you look.
- A synthesized voice can cost the user money, on their own account.
  Which account pays is always their choice: ask them, and never pick
  one yourself. The guide's "Synthesized voiceovers" has the setup.
- `showcase.yaml`: change it only with `edit_showcase`. It can set every
  field, including a new showcase's scenes (`scene.insert`). One call
  applies a whole batch — retiming every scene, say — as one checked
  write that keeps the file's formatting. Never sed, awk, or throwaway
  scripts. If the tool refuses a change you need, tell the user what it
  said.
- Always pass `ifVersion` to `edit_showcase`. Get it from `read_showcase`,
  or use the `version` your last `edit_showcase` returned. If the file
  changed since then, the call is refused and its error lists what
  changed. Read the showcase again before you retry.
- The user may edit in the studio while you work, and you get no message
  when they do. So what you read earlier can be out of date.
  `studio_start` returns `changes`, the studio's change log: one JSON
  line per write. Once the studio is open, watch it with the Monitor tool
  for the rest of the session:

  ```bash
  tail -n 0 -F '<changes>' | grep --line-buffered '"source":"ui"'
  ```

  Each line is one edit the user made. Take it into account before your
  next change, and don't undo it.

- `theme.yaml`: use `edit_theme` (pass the `themeVersion` from
  `read_showcase` as `ifVersion`).
- `assets/`, `graphics/`: edit the files directly. The studio reloads by
  itself.
- A showcase's media is of two kinds, and both belong in it:
  - **Screenshots and recordings of the product** — the product in the
    folder the showcase is being made for. Don't fabricate these. When
    the user gives you a path to an image or video (dragging a file into
    the chat gives you its path), pass it to `add_asset`. It copies the
    file into the showcase's `assets/` and tells you the key to use. An
    image pasted into the chat has no path: ask the user to drag the file
    in instead, or onto the studio's Assets page. Use `add_asset` too for
    anything you captured yourself (a simulator, a browser, their screen)
    when they asked for it, and say what you captured.
  - **Diagrams and explainers you draw** — write them as TSX graphics
    (`<id>/graphics/<key>.tsx`, used as
    `media {kind: graphic, graphic: <key>}`). The guide has the rules. A
    scene explaining a flow or a comparison is often better as a graphic
    than as a screenshot of a screen that doesn't show it.

  One thing that is never source media: `screenshot_slide` captures a
  finished slide, not the product.

- Video of a person talking to the camera: the bottom caption often
  covers their chin or mouth. `check_framing` finds every caption that
  covers a face and says how to move the picture or the caption. The
  guide's "Keep the face clear of the captions" has the rule.

## 4. Check before you say it's done

1. Run `validate` after changing YAML.
   When titles changed, run `check_titles` too, and hand its `brief` to a
   new subagent that sees nothing else. The guide's "Check the titles"
   says how to read the answers. When captions changed, do the same with
   `check_script` (the guide's "Narration").
2. Look at the result. In the preview panel, read the page first: the
   user may have moved to another page or slide. Without a panel, use
   `screenshot_slide`. For anything about the video at a moment — a
   caption over a face, a cut landing on a word, a graphic clear of
   TikTok's interface — use `screenshot_frame` with the times to check
   (`safeArea: true` shades TikTok's interface), not a draft export.
3. Tell the user only what you have seen working. If a check failed, say
   which one and quote its error. Never describe a screenshot or a page
   you didn't get back.
4. If a check failed because the page didn't load, call `studio_info`
   and read `pageError`. It holds the error the studio page hit on the
   server (`message`, `stack`, `path`). Tell the user that error. Don't
   just say the page didn't load.

## 5. Finish

- Exports: `export`, then `export_status {waitMs: 120000}`. Each call
  waits up to two minutes. If the export is still running, call it again:
  a full-quality export of a long showcase can take several calls. Don't
  wait with sleeps.
- Posting to TikTok, Instagram, YouTube Shorts or YouTube (a regular
  video): the guide's "Sharing" section has the steps. In short: write
  the post's text with `edit_showcase` (`publish.set`), check it with
  `share_status` for the destinations the user is posting to, and make
  sure there is a current full-quality export of the kind each one takes
  (`video-43` for regular YouTube, `video` for the others). Then open
  the Share page (`share_status` returns its URL as `page`) in the
  preview, or call `share` to hand the video off from this computer.
  Nothing is posted for the user; they post on the platform's own page.
  Afterwards, keep the post's link with `share_record`.
- History: when the library is in a git repository, `studio_start`
  reports `history`. If `history.autoCommit` is false, the studio makes
  no commits on its own: nothing is committed until you call
  `commit_showcase`.
  - After you finish a meaningful change, call `commit_showcase` with a
    clear message, such as "Retime scenes to the new voiceover". That
    includes files you wrote with your own tools, like a graphic.
    Don't run `git commit` yourself.
  - When the user asks to undo, compare, or branch, use git history. Look
    first (`git log --stat -- <showcase>`) and confirm which change they
    mean. Undo with `git revert <sha>`, which adds a new commit. Never
    reset. Branch with `git switch -c <name>`.
  - If `history` says the library isn't a git repository, the studio
    starts one itself the first time it saves a change — don't run
    `git init`. When it won't, `history.reason` says why.
