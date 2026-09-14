# Showcase Studio

Create videos of your app with the Claude Code subscription you already
have. The video is files in your repo, Claude Code is the editor, and a
teleprompter travels to your phone when it's time to record.

There is no timeline to drag around and no video editor to learn. A
showcase — an auto-playing, video-style product tour — is a YAML script
plus your screenshots and recordings, kept in a folder you can commit,
branch, review, and revert like any other code. Change a line or swap a
screenshot, and the video re-renders. The words define the timing: a
scene lasts as long as it takes to say its lines, so shortening a
sentence shortens a scene.

## The data model

A showcases folder holds one subfolder per showcase:

```
my-showcases/
  my-app/
    showcase.yaml   the script: scenes, narration, media, timings
    assets/         screenshots, clips, voiceover recordings
    theme.yaml      optional styling (colors, fonts, atmosphere)
    graphics/       optional TSX-drawn diagrams, compiled live
```

`showcase.yaml` is the whole video. Each scene declares a **theme** — one
of four fixed layouts (`statement` for centered claims, `feature` for a
phone-framed screenshot, `console` for wide desktop shots and diagrams,
`footage` for edge-to-edge on-camera video) — plus **captions** (the
narration, read verbatim in order; they are the only spoken lines),
**media** (an asset key: `asset: shot-mirror` finds
`assets/shot-mirror.png` — no registry), and optionally a pinned
`durationMs` when syncing to a recorded voiceover. Authoring context
lives in `note` fields on scenes and `meta.notes` on the showcase, so it
travels with the data through every edit.

## The studio

Showcase Studio runs in your browser (`npm run dev`) or as a desktop app.
Point it at a folder (`--library`, or File > Open Folder… in the desktop
app) and every showcase in it plays immediately; edits to any file appear
live. A paused player is an editor: slide titles are
click-to-edit, media areas open an asset picker, and a style panel
adjusts the theme. The assets page manages the media collection —
drag-and-drop uploads, per-scene usage, renames that update every YAML
reference.

Claude Code is built in. Each showcase gets a persistent terminal
running in that showcase's folder, and the studio hands it everything it
needs: a generated guide (`.studio/GUIDE.md`, rewritten on every launch
so it always matches the running app) and MCP tools —

- `studio_info` — the running studio's URL, library, and lock
- `edit_showcase` — structured script edits (scene fields, captions,
  meta, insert/move/delete), validated and applied as one write that
  preserves the file's formatting
- `screenshot_slide` — render one slide and see it, after any edit
- `validate` — load the whole library and report errors and lint warnings
- `transcribe` — whisper.cpp voice-to-text with per-word timestamps
- `export` / `export_status` / `export_cancel` — renders as cancellable
  background jobs

So "make me a 60-second tour of this app" is a conversation: Claude
reads your project, drafts the script, checks its own slides, and
renders a draft — billed to the subscription you already have. A Claude
Code session working in this repo gets the same tools through `.mcp.json`,
and `npm run dev:claude` runs a studio for it to drive.

## Recording yourself

The script page doubles as a teleprompter that scrolls at speaking pace.
"Share prompter" publishes the script to an unguessable URL so the
teleprompter runs on your phone while you film with the phone camera —
takes stay on the device. For on-camera pitches, the studio's guide
walks Claude through the full recipe: cut the take into per-scene clips,
extract the voiceover as a synced soundtrack, and drive word-by-word
karaoke captions from the transcript's timestamps.

## Exports

One script fans out to every destination:

| Export    | What you get                                             |
| --------- | -------------------------------------------------------- |
| Video     | 1320×2868 portrait MP4 (TikTok and friends), frame-exact |
| Video 4:3 | 1440×1080 MP4 for YouTube and desktop embeds             |
| Screens   | The App Store screenshot set (6.9", 1320×2868)           |
| Script    | The narration as plain text                              |

Exports run from the app (to `~/Downloads/showcase-exports/<id>`), from
Claude via the MCP job tools, or from the command line (`--export`).

## Running it

```sh
npm i
npm run dev               # the full studio in your browser
npm run dev:electron      # the same studio in a desktop window
npm run dev:claude        # the same studio, driven by Claude Code
npm run package:desktop   # build the desktop app → dist-electron/dist/mac-arm64/Showcase Studio.app
```

Every mode prints the studio's URL; `npm run dev -- --help` lists the
options.

This repo's `showcases/` folder holds the samples — including
`showcase-studio`, the studio's own tour, made entirely with the studio.

## How it's put together

| Part            | Role                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`          | The player, slide themes, script/teleprompter, assets and export pages (TanStack Start + React + Tailwind)                                                                         |
| `server/`       | The studio — plain Node, no Electron: the studio server (library data, page API, live events, MCP), the comment-preserving YAML edit path, exports, terminals, the generated guide |
| `electron/`     | Packaging only: the desktop window, system menus, and the packaged app's page renderer                                                                                             |
| `web/prompter/` | The shared-teleprompter site a phone loads                                                                                                                                         |
| `cdk/`          | AWS infra for the prompter site (S3 + CloudFront + one publish Lambda)                                                                                                             |

Every mode runs the same studio server — the dev server mounts it, and so
does the packaged app — so the page never knows which one it's talking
to.

Development commands and conventions are in [CLAUDE.md](CLAUDE.md).
