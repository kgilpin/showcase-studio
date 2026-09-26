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
2. The tools appear only after Claude Code reconnects to the server. Ask
   the user to run `/mcp` and reconnect `showcase-studio`, or to start a
   new session, then continue with step 1 below.

If `studio_start` works but the `version` it returns differs from
`<plugin>/app-version`, run the installer too — it replaces the app with
the expected version — and ask for the reconnect.

**Running from source.** When the environment variable
`SHOWCASE_STUDIO_SRC` is set, the tools run the studio from that source
checkout instead of the app. Then skip the installer and the version
check. If the tools are missing, the server's error message says why
(a wrong path, or no Node 22). Tell the user what it says.

## 1. Start the studio

| The user gave   | Call                                                   |
| --------------- | ------------------------------------------------------ |
| a showcase name | `studio_start` with `showcase: <name>`                 |
| `new`           | `studio_start` with `new: true`                        |
| nothing         | `studio_info`, list its `showcases`, and ask which one |

Show the studio in one place only:

- **You have a browser preview panel** (a `preview_start` tool): start
  without a window, then open the returned `open` URL with `preview_start`.
- **You don't:** pass `window: true`. The studio opens its own window.
  From source there is no window: give the user the `open` URL to open
  in a browser.

The library is the folder the studio keeps showcases in. By default it
is the folder Claude Code runs in. If the user means another folder, pass
`library`. `studio_start` returns the folder in use as `library`, and
says why in `libraryReason`. Tell the user which folder it is, in full,
before you create a showcase, so they know where to find it.

If `studio_start` answers `started: false` with `chooseLibrary`, the
folder Claude Code runs in holds other files, or is the home folder, so
the studio won't guess. Ask the user the question in `next`, then call
`studio_start` again with their answer as `library`. A folder that
doesn't exist yet is created.

Don't start the studio any
other way: no `npm run dev`, and no `.claude/launch.json` config with
`preview_start` `name`. Those start a second studio that the tools don't
use. If the user started one with the preview's button, stop it with
`preview_stop` and open the `open` URL instead. The studio stops when
this session ends.

If `studio_start` answers `started: false` with `alreadyOpen`, another studio already has
the library open — usually another Claude session. Don't work on the same
files. Do what its `next` says: in git, offer the user a worktree (a
separate copy with its own studio) and say what the copy won't have;
otherwise, ask them. The guide's "When another studio already has this
library open" has the details.

## 2. Read the guide first

`studio_start` returns `guide`: the path of the library's
`.studio/GUIDE.md`. Read that file before you open or change any showcase
file — even for a one-line change. (If you only called `studio_info`, the
guide is `.studio/GUIDE.md` in its `library` folder.)

The guide explains the format: themes, captions, media, timing, and the
recipes for recorded pitches. The studio rewrites it on every start, so it
matches the running app. Don't learn the format from other showcases or
from the app's source.

## 3. Make changes

- `showcase.yaml`: use `edit_showcase` for anything it can express. One
  call applies a whole batch — retiming every scene, say — as one write
  that keeps the file's formatting. For anything else, use your
  file-editing tool. Never sed, awk, or throwaway scripts.
- Always pass `ifVersion` to `edit_showcase`. Get it from `read_showcase`,
  or use the `version` your last `edit_showcase` returned. If the file
  changed since then, the call is refused and its error lists what
  changed. Read the showcase again before you retry.
- The user may edit in the studio while you work. Those edits don't show
  up anywhere you'd notice. `studio_start` returns `changes`, the
  studio's change log: one JSON line per write. Once the studio is open,
  watch it with the Monitor tool for the rest of the session:

  ```bash
  tail -n 0 -F '<changes>' | grep --line-buffered '"source":"ui"'
  ```

  Each line is one edit the user made. Take it into account before your
  next change, and don't undo it.

- `theme.yaml`, `assets/`, `graphics/`: edit the files directly. The
  studio reloads by itself.
- You can't make screenshots or recordings. Ask the user to drop them
  into the showcase's `assets/` folder, or to paste or drag them onto the
  studio's Assets page. An image pasted into the Claude chat never
  reaches a file you can read.

## 4. Check before you say it's done

1. Run `validate` after changing YAML.
2. Look at the result. In the preview panel, read the page first: the
   user may have moved to another page or slide. Without a panel, use
   `screenshot_slide`.
3. Tell the user only what you have seen working. If a check failed, say
   which one and quote its error. Never describe a screenshot or a page
   you didn't get back.
4. If a check failed because the page didn't load, call `studio_info`
   and read `pageError`. It holds the error the studio page hit on the
   server (`message`, `stack`, `path`). Tell the user that error. Don't
   just say the page didn't load.

## 5. Finish

- Exports: `export`, then `export_status` until it's done.
- History: when the library is in a git repository, `studio_start`
  reports `history`. If `history.autoCommit` is false, the studio makes
  no commits on its own: nothing is committed until you call
  `commit_showcase`.
  - After you finish a meaningful change, call `commit_showcase` with a
    clear message, such as "Retime scenes to the new voiceover". That
    includes files you wrote with your own tools, like a graphic or
    theme.yaml. Don't run `git commit` yourself.
  - When the user asks to undo, compare, or branch, use git history. Look
    first (`git log --stat -- <showcase>`) and confirm which change they
    mean. Undo with `git revert <sha>`, which adds a new commit. Never
    reset. Branch with `git switch -c <name>`.
  - If `history` says the library isn't a git repository, the studio
    starts one itself the first time it saves a change — don't run
    `git init`. When it won't, `history.reason` says why.
