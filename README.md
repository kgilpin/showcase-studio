# Showcase Studio

Showcase Studio makes video-style product tours of your app. A showcase
is a folder of files: a YAML script plus your screenshots and
recordings. Claude Code is the editor. You ask for changes in plain
words, and the studio shows the result as a video that plays in the
browser. When it looks right, export it as an MP4 or a set of App Store
screenshots.

There is no timeline to drag around. The words set the timing: a scene
lasts as long as it takes to say its lines, so a shorter sentence makes
a shorter scene. Because a showcase is just files, you can commit,
branch, review, and revert it like any other code.

## Get started in Claude Code Desktop

Showcase Studio comes as a Claude Code plugin. The plugin runs the
studio and gives Claude the tools to edit and check a showcase.

**1. Install the plugin.** In a terminal:

```sh
claude plugin marketplace add kgilpin/showcase-studio
claude plugin install showcase-studio@showcase-studio
```

**2. Open a library folder.** A library is a folder that holds your
showcases, one subfolder each. Start a Claude Code session in that
folder.

**3. Run the skill.**

```
/showcase-studio:showcase <name>     work on the showcase in <name>/
/showcase-studio:showcase new        make a new showcase
/showcase-studio:showcase            list the showcases and pick one
```

Claude starts the studio and opens it in the preview panel. (Without a
preview panel, the studio opens in its own window.) Then you talk to
Claude, and you can also edit in the studio yourself.

```
  you ──► Claude Code ──► plugin tools ──► studio ──► files in the library
                                              │
                    preview panel ◄───────────┘  (reloads when files change)
```

**The first time,** the plugin also needs the Showcase Studio app. If it
isn't installed, Claude runs the plugin's installer (`bin/install-app`).
It downloads the app from this repo's GitHub releases, checks its
SHA-256 hash, and puts it in `~/Applications`. It needs:

- a Mac with Apple Silicon
- the GitHub CLI (`gh`), logged in with access to this repository

After the install, run `/mcp` and reconnect `showcase-studio` (or start a
new session) so the tools appear.

### Your edits and git

When the library folder is in a git repository, the studio commits each
showcase's changes on its own, a few seconds (5 s) after they stop.
Edits from Claude and edits you make in the studio are both committed.

| You want to…            | Do this                                                  |
| ----------------------- | -------------------------------------------------------- |
| Turn commits off or on  | The "Commit changes to git" switch under the gear button |
| Undo an older change    | Ask Claude; it finds the commit and runs `git revert`    |
| Try another cut         | Ask Claude to branch (`git switch -c <name>`)            |
| Use git in a new folder | Nothing — the studio starts the repository itself        |

A folder that isn't in a git repository gets one the first time the
studio saves a change, so your work has a history from the first edit.
It won't do that where a repository would take in far more than your
showcases (a home folder, a volume root), and turning commits off stops
it too.

### Exports

Ask Claude for an export, or use the Export page in the studio. Files
land in `~/Downloads/showcase-exports/<id>`.

| Export    | What you get                                             |
| --------- | -------------------------------------------------------- |
| Video     | 1080×1920 (9:16) MP4 for TikTok and friends, frame-exact |
| Video 4:3 | 1440×1080 MP4 for YouTube and desktop embeds             |
| Screens   | The App Store screenshot set (6.9", 1320×2868)           |
| Script    | The narration as plain text                              |

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

The studio plays every showcase in the library. A paused player is an
editor: click a slide title to edit it, click a media area to pick an
asset, and adjust colors in the style panel. The script page edits the
captions. The Assets page manages the media: drag files in or paste an
image, see which scenes use each file, and rename a file along with
every reference to it.

Claude works through the studio's MCP tools:

- `studio_start` / `studio_info` — start the studio, or find the running one
- `read_showcase` / `edit_showcase` — read the script, and make
  structured edits (scene fields, captions, meta, insert/move/delete) as
  one write that keeps the file's formatting
- `screenshot_slide` — render one slide and look at it
- `validate` — load the whole library and report errors and warnings
- `transcribe` — whisper.cpp voice-to-text with per-word timestamps
- `script` — the narration as plain text
- `commit_showcase` — commit a finished change with a clear message
- `export` / `export_status` / `export_cancel` — renders as background jobs

The studio also writes a guide for Claude, `.studio/GUIDE.md`, into the
library. It is rewritten on every start, so it always matches the
running app.

## Recording yourself

The script page doubles as a teleprompter that scrolls at speaking pace.
"Share prompter" publishes the script to an unguessable URL so the
teleprompter runs on your phone while you film with the phone camera —
takes stay on the device. For on-camera pitches, the studio's guide
walks Claude through the full recipe: cut the take into per-scene clips,
extract the voiceover as a synced soundtrack, and drive word-by-word
karaoke captions from the transcript's timestamps.

## The desktop app and its built-in terminal

You can also run the studio without the plugin. The desktop app opens a
library in its own window (File > Open Folder…). Inside a showcase, it
has a built-in terminal: one persistent Claude Code session per showcase,
running in that showcase's folder. When `claude` isn't installed, the
terminal opens a plain shell instead. A studio
that the plugin starts turns these terminals off, because Claude is
already driving it from outside.

Exports also run from the app, and from the command line (`--export`).

## Running from source

For contributors. Development commands and conventions are in
[CLAUDE.md](CLAUDE.md).

Node 22 comes from [Volta](https://volta.sh), pinned in package.json:
`brew install volta && volta setup`, then open a new terminal.

```sh
npm i
npm run dev               # the full studio in your browser
npm run dev:electron      # the same studio in a desktop window
npm run package:desktop   # build the desktop app → dist-electron/dist/mac-arm64/Showcase Studio.app
```

Every mode prints the studio's URL; `npm run dev -- --help` lists the
options. A Claude Code session in this repo starts a studio from source
through `.mcp.json`.

To use the plugin with your checkout instead of the installed app, set
`SHOWCASE_STUDIO_SRC` to the checkout (for example in the library's
`.claude/settings.local.json` under `"env"`). The plugin then runs the
studio from source with Node 22 or later.

This repo's `showcases/` folder holds the samples — including
`showcase-studio`, the studio's own tour, made entirely with the studio.

### The AppMap skills

Changes here are reviewed against recorded test runs — the gold traces in
`gold_traces/`. Recording them, blessing them, and comparing two
revisions needs the AppMap skills, which are **not** kept in this repo.
Install them once, for your user:

```sh
git clone https://github.com/getappmap/skills.git ~/.appmap/skills
mkdir -p ~/.claude/skills
for skill in appmap-gold-traces appmap-record appmap-review appmap-config; do
  ln -s ~/.appmap/skills/$skill ~/.claude/skills/$skill
done
```

A release runs them (`.claude/skills/studio-release`), so they need to be
installed before you cut one.

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
