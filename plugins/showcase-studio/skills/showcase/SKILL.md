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

The library is the folder Claude Code runs in when it holds showcases. If
the user means another folder, pass `library`. Don't start the studio any
other way (no `npm run dev`). It stops when this session ends.

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
- `theme.yaml`, `assets/`, `graphics/`: edit the files directly. The
  studio reloads by itself.
- You can't make screenshots or recordings. Ask the user to drop them
  into the showcase's `assets/` folder.

## 4. Check before you say it's done

1. Run `validate` after changing YAML.
2. Look at the result. In the preview panel, read the page first: the
   user may have moved to another page or slide. Without a panel, use
   `screenshot_slide`.
3. Tell the user only what you have seen working. If a check failed, say
   which one and quote its error. Never describe a screenshot or a page
   you didn't get back.

## 5. Finish

- Exports: `export`, then `export_status` until it's done.
- The library may be a git repository the user manages. Commit only when
  asked.
