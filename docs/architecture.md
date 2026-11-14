# How the pieces fit

Detail that has no single home file. Each module's own header comment
says what that module does; this page says how they connect.

## The studio and its three ways to run

Every studio feature is plain Node in `server/` (no Electron imports),
unit-tested and gold-traced. `createStudio()` in
`server/studio-server.mjs` is one request handler, mounted by every way
of running it:

```
                       ┌────────────────────────────┐
 npm run dev ─────────►│ scripts/dev.mjs            │
 npm run dev:electron  │ Vite + the studio server   │  one port: page, library
   (same, in a window) │ mounted in it              │  data, studio API, MCP
                       └────────────────────────────┘
                       ┌────────────────────────────┐
 Showcase Studio.app ─►│ electron/main.mjs          │  the built app (.output/)
                       │ + the studio server        │  and the studio server,
                       └────────────────────────────┘  in-process, free ports
                       ┌────────────────────────────┐
 Claude Code ─────────►│ server/mcp-stdio.mjs       │  MCP over stdio; owns
  (.mcp.json, or the   │ studio_start / studio_stop │  one studio process
   plugin's --mcp)     └────────────────────────────┘
```

- `npm run dev` picks the port from `PORT` when a launcher sets it, else a
  free one, and prints it as `studio: <url>`. The library defaults to this
  repo's `showcases/` (`--library` picks another).
- The packaged app runs any number of studios at once. From Finder, a
  second instance needs `open -n`.
- In every mode the page reaches the studio over HTTP (`src/lib/studio.ts`).
  Everything the studio serves (library files, API, events, MCP) only
  answers requests made on this machine, and the dev server listens on
  localhost only.
- Settings are command-line flags, not environment variables
  (`npm run dev -- --help`; the packaged app takes the same:
  `open -n "Showcase Studio.app" --args <options>`).

### Claude Code's own studio

Claude Code starts a studio of its own through an MCP server on stdio
(`server/mcp-stdio.mjs`), with the Claude terminals off. stdout is the MCP
channel, so all other output goes to stderr. `studio_start` starts it
(optionally locked to one showcase) and returns the URL to open, for
example in Claude Code's preview. `studio_stop` stops it, and it stops with
the Claude Code session. There is nothing to find and no port to set.

| Where Claude Code runs | What starts the studio                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| In this repo           | `.mcp.json` runs `scripts/studio-mcp.mjs`: the `npm run dev` studio, from source                                                        |
| Anywhere else          | The showcase-studio plugin (`plugins/showcase-studio/`, listed in `.claude-plugin/marketplace.json`) runs the packaged app with `--mcp` |

With the plugin, `studio_start {window: true}` opens the app's own window.
Without it the app runs with no window or Dock icon. Closing that window
leaves the studio running for Claude. The plugin's
`/showcase-studio:showcase` skill is a working session: start the studio,
read the guide, edit, check.

To try the plugin on a local build, in a library folder:

```sh
SHOWCASE_STUDIO_APP=<repo>/dist-electron/dist/mac-arm64/Showcase\ Studio.app \
  claude --plugin-dir <repo>/plugins/showcase-studio
```

Or from source: set `SHOWCASE_STUDIO_SRC=<repo>` (for example in the
library's `.claude/settings.local.json` `"env"`) and the plugin runs
`scripts/studio-mcp.mjs` with Node 22 instead.

The plugin's library defaults to the folder Claude Code runs in (or a
`showcases` folder inside it), never the app's last folder or
`~/Showcases`. When that folder holds other files, or is the home folder,
`studio_start` starts nothing and answers `{started: false, chooseLibrary,
next}`, so Claude asks the user (`libraryForClaude` in
`server/launch-options.mjs`).

From source, the studio runs as a child process of the MCP server
(`server/child-studio.mjs` runs `scripts/dev.mjs --no-terminal
--no-auto-commit`), so each `studio_start` runs the code as it is then.
After changing server code, `studio_stop` then `studio_start` picks it up.
Until then the page shows a banner saying to restart, and `studio_info`
lists the changed files as `changedCode`. To try a git worktree's changes,
pass `studio_start` `source: <worktree>`; its `showcases/` is the default
library, and it needs its own `node_modules`. The tool list itself is read
when the session starts, so a tool whose inputs changed still needs a
reconnect. For the embedded terminals, which Claude's studio turns off,
run `npm run dev` in a terminal.

### One studio per library

A studio notes its address in `.studio/studio.json`. `npm run dev`, the
app, and File > Open Folder refuse a library whose noted studio still
answers there, naming the address. A crashed studio can't answer, so the
note it leaves never blocks. `--export` runs skip the check (they run
beside an open studio). Claude's `studio_start` doesn't refuse: it starts
nothing and tells Claude to offer the user a git worktree (a separate copy
with its own studio), or, outside git, to ask. Two sessions on the same
files end badly, whichever started the other.

### Locking a studio to one showcase

`--open <showcase folder>` shows that showcase (its parent folder is the
library). `--new [<library folder>]` shows the New showcase page (`/new`)
until it creates one, then locks to it. A locked studio has no Home link,
no File > Open Folder or Open Recent, and navigation outside the showcase
goes back to it.

## Libraries

On start the studio scaffolds the library with a README, `.gitignore`,
`CLAUDE.md`, `showcase_settings.yaml` and `.studio/` files, and rewrites
`.studio/GUIDE.md` every time. It watches the library:

```
 change inside one showcase folder, or a   ──► "showcase-changed" ──► page re-reads it in place
   new showcase folder                                               (reloads itself for a new one)
 a showcase folder removed, or a file at   ──► "reload"           ──► page reloads
   the library root
 the studio's own writes (matched by content hash) ──► swallowed (the page already has them)
```

The page side is `src/lib/live-updates.ts` and `refreshShowcase` in
`src/content/showcases.ts`. Asset URLs carry the file's modified time
(`?v=`), so a rebuilt voiceover or clip is a new URL.

## Screenshots, exports and renderers

Screenshots and exports draw pages with Playwright from source
(`server/renderer-playwright.mjs`, Google Chrome when installed, since its
bundled Chromium can't play MP4 video) and with Electron's offscreen
windows in the packaged app (`electron/renderer.mjs`). They are encoded
with the bundled ffmpeg. Exports land in
`~/Downloads/showcase-exports/<id>` unless the library's `export_dir`
says otherwise.

## The page

- `src/routes/`: TanStack Router file routes: `/` (home), `/new` (studio
  only), `/showcase/$showcaseId` with `/script`, `/assets` (the media
  collection, with usage and rename in the studio), `/share` (studio only;
  parts in `src/components/share/`), `/export`, `/export/$sceneId` and
  `/record`.
- The player page takes `?view=tiktok|screens|embed`. Otherwise it opens
  in the showcase's `meta.view`, else the view this browser last used,
  else TikTok.
- `src/components/showcase/`: the player (`ShowcasePlayer`, `SceneView`
  for slide layouts, `SceneMedia` for motion, `ProgressRail`,
  `Soundtrack`) and `ShowcaseFrame`, the frame around a showcase's screens.
- `src/components/script/`: the script listing and teleprompter.
- `src/components/studio/`: the studio's panels. The top bar's activity
  slot and the Actions list are `StudioActivity.tsx`.
  `StudioToaster.tsx` only hosts short notices.

## The shared-teleprompter site (`web/prompter/`)

One static page that fetches `/scripts/<token>.json` (published by the
studio's "Share prompter" button) and runs `ScriptPlayer` on a phone.
Camera takes save on the device; nothing comes back. It has its own vite
config (`npm run build:prompter`) so it stays thin.
`public/scripts/sample.json` is the dev fixture (`/p/sample`). Deploying
it: `docs/deploy.md`.

## The marketing site (`site/`)

A TanStack Start app, prerendered by `vite build` into `dist/client` and
served as static files by a Cloudflare Worker, so no page is rendered on a
request.

- Words: `content/*.yaml`, one file per page (`home`, `features`, `faq`,
  `pricing`, `download`) plus `shared.yaml` (head tags, top bar, footer,
  install cards, the closing "Try it" block, the not-found page). Text may
  carry `<strong>`, `<code>`, `<small>`, `<mark>` and `<a href="...">`
  (`src/markup.ts`, rendered by `src/components/Markup.tsx`; an href of
  `portal` is Stripe's portal sign-in). `src/content.ts` imports and types
  the files; the `yaml` plugin in `vite.config.ts` turns each import into
  data at build time, so the page ships no parser.
- Pictures are drawn in the routes. A picture's own words are in the YAML
  under `art`, and `type` picks the drawing.
- Routes: `__root.tsx` (shared `<head>`; each route sets its own canonical
  link), `index.tsx` (a short overview), `features.tsx` (seven sections,
  each a picture with numbered circles beside three features), `faq.tsx`,
  `pricing.tsx` (the trial and the $9.50/month subscription side by side,
  then questions about the subscription), `download.tsx` (`/download`
  only; everything under `/download/` is a release file), and `404.tsx`,
  prerendered to `404.html` (`not_found_handling` in `wrangler.toml`), with
  its scripts stripped by `scripts/static-404.mjs`.
- Every page is written as `<name>.html`, so Cloudflare serves it at
  `/<name>` with no trailing slash.
- `src/components/Site.tsx` is the shared top bar and footer.
  `src/components/` also holds the parts that run in the browser (the
  caption highlight, the hero video's player, the Copy button) and the
  destination logos. `src/styles.css` is the stylesheet.
- `worker.js` runs only for `/media/*` (byte-range requests, which Safari
  needs for the hero video) and `/download/*` (releases from the R2
  bucket, since zips are too big for static files, which Cloudflare caps
  at 25 MiB).
- `public/` is copied as is: `_headers`, `icon.svg`, `robots.txt`,
  `sitemap.xml`, and `media/` (made by `scripts/prepare-media.mjs`).
- The download buttons link to `/download/latest/*`, so a release doesn't
  touch the pages. The GitHub release stays as the private record of each
  build; users download from the site.
- The Pricing page's Subscribe button posts to the license service's
  `/checkout`; "Manage subscription" goes to Stripe's Customer Portal
  sign-in.

## The release rehearsal (`rehearsal/`, `scripts/rehearsal/`)

A test of the authoring process, not of the code's output. A fresh Claude
session builds a showcase from raw inputs through the plugin, and the
transcript is graded for whether the capabilities added since the last
release got used and helped.

- `rehearsal/scenarios/<name>/`: what a run starts from (the brief in the
  user's words, naming no tool; the raw files; the scratch library's
  settings; the rubric).
- `scripts/rehearsal/`: the runner (`run.sh`, `claude -p` with the plugin
  on a scratch library, from a checkout or the packaged app), the
  follower, the grader, and the outside verifier.
- `rehearsal/reports/`: what each run found.

Runs land outside the repository (`$TMPDIR/showcase-rehearsal/`), so the
scratch library gets a history of its own and a session can't browse the
scenarios. The `rehearsal` skill is the procedure; the release skill runs
it between the build and the tag.

## Gold traces (`gold_traces/`, `cdk/gold_traces/`)

The AppMap baseline. `manifest.yaml` lists one lean, deterministic trace
per subsystem (recorded from the tests with appmap-node).
`baseline/appmaps/` holds the blessed, cleaned recordings. They are kept up
with the `appmap-gold-traces` skill, installed from
[getappmap/skills](https://github.com/getappmap/skills) and not vendored
here (the README's "The AppMap skills" says how).
