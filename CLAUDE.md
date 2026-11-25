# Development guide

Each module's header comment says what it does. How the pieces connect is
in [docs/architecture.md](docs/architecture.md). Deploying the AWS stacks
and the marketing site is in [docs/deploy.md](docs/deploy.md). Licensing
is in [docs/licensing.md](docs/licensing.md).

## Setup

- Node 22, through [Volta](https://volta.sh) (`brew install volta && volta setup`),
  which uses the version pinned in package.json. `onboarding.yaml` lists
  every setup step.
- A bare `node` on PATH can be ancient (v12 has appeared in shells here,
  and it can't parse the server modules). Run checks through the npm
  scripts or `volta run node …`. `npm i` and `npm run dev` stop with a
  plain message on anything older (`scripts/check-node.cjs`, from
  package.json's `engines`).
- `npm i` installs the browser studio, exports and tests.
  `npm run setup:desktop` adds the Electron shell's own dependencies
  (`electron/node_modules`), which only `dev:electron`, `package:desktop`
  and `release:desktop` need. Electron fetches its 300 MB binary on first
  use.

## Commands

| Command                                                         | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                                   | The full studio in a browser, from source. Prints `studio: <url>`. `-- --help` lists every option; settings are flags, not environment variables.                                                                                                                                                                                                                                                                                                                          |
| `npm run dev:electron`                                          | The same in an Electron window, with system menus.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `npm run dev -- --open <showcase folder>` / `--new [<library>]` | Lock the studio to one showcase.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `npm test`                                                      | vitest.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `npm run lint` / `npm run format`                               | eslint / `prettier --write .`                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `npm run build` / `npm run preview`                             | Production build / serve it locally.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `npm run export:screens [-- <id>]`                              | App Store screenshots to `exports/<id>/`. Needs a running studio: pass its URL as `BASE_URL` (or use `npm run dev -- --export screens:<id>`). First time: `npx playwright install chromium`. Slide titles shown, captions off.                                                                                                                                                                                                                                             |
| `npm run export:video [-- <id>]`                                | MP4 at 1080×1920, 30 fps, frame by frame (slow but exact), to `exports/<id>/video.mp4`. Captions over the media, titles hidden. `-- --realtime`: a quick 360×640 draft (`video-draft.mp4`). `-- --prompter`: record the `/script` page as a 1280×720 draft (`prompter-draft.mp4`; needs the dev server).                                                                                                                                                                   |
| `npm run export:script [-- <id>]`                               | Print the narration as plain text, straight from the YAML. No server needed.                                                                                                                                                                                                                                                                                                                                                                                               |
| `npm run build:prompter` / `npm run dev:prompter`               | The shared-teleprompter site (`web/prompter`). Dev server on :8097; `/p/sample` serves the checked-in fixture.                                                                                                                                                                                                                                                                                                                                                             |
| `npm run vendor:whisper`                                        | Put `whisper-cli` in `electron/vendor/whisper/` (gitignored). Built from source on macOS (needs cmake for this Mac's architecture; an Intel cmake under Rosetta is refused) and on Linux x64 (cmake and build-essential). Downloaded from a pinned, checksummed build on Windows. Leaves an existing binary alone (`-- --force` replaces it). The speech model downloads on first transcription.                                                                           |
| `npm run package:desktop`                                       | Runnable app in `dist-electron/dist/mac-arm64/`. Runs `vendor:whisper`, `build:desktop`, `scripts/package-desktop.mjs`, then electron-builder.                                                                                                                                                                                                                                                                                                                             |
| `npm run release:desktop`                                       | The same, signed and notarized, with SHA256SUMS. Needs the Developer ID certificate and the notarization credentials (listed in `electron-builder.yml`). Check with `spctl -a -vv <app>`. The whole release is the `/studio-release` skill.                                                                                                                                                                                                                                |
| `npm run package:linux`                                         | The Linux x64 build: no Electron, no window. On Linux x64 with Node 22 only (CI builds it: `.github/workflows/desktop-build.yml`). Writes `dist-linux/Showcase-Studio-<version>-linux-x64.tar.gz` and `SHA256SUMS-linux-x64`. The tarball holds `showcase-studio/`, with Node inside; its launcher `bin/showcase-studio` takes the app's options (`--mcp`, `--export <kind>:<id>`, `--library`). Exports draw pages with Google Chrome (`bin/install-chrome` installs it). |
| `npm run build:icon`                                            | Render `build/icon.svg` to `build/icon.png`. Commit both.                                                                                                                                                                                                                                                                                                                                                                                                                  |

The marketing site (`site/`) is its own npm package:

| Command (in `site/`)                  | What it does                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run dev`                         | Hot reload on http://localhost:8098 (`PORT` when a launcher sets it).                                                                                                    |
| `npm run build` / `npm run typecheck` | Prerender into `site/dist/client` / tsc.                                                                                                                                 |
| `npm run dev:wrangler`                | Build, then serve the way Cloudflare does, with `/download/*` from wrangler's local R2 bucket.                                                                           |
| `npm run media`                       | Make `site/public/media` from exports. Export first, at the root: `npm run dev -- --export video:showcase-studio` and `--export video-draft:nova`. Commit the results.   |
| `npm run capture:prompter`            | Capture the NOVA teleprompter picture into `site/media-src/` from a studio on :8123 (`PORT=8123 npm run dev -- --no-terminal --no-auto-commit --alongside` at the root). |
| `npm run deploy`                      | See [docs/deploy.md](docs/deploy.md). Nothing deploys the site on push.                                                                                                  |

## Claude Code and the studio

- Claude Code starts its own studio through MCP: `studio_start` returns
  the URL to open in the preview, `studio_stop` stops it. In this repo
  `.mcp.json` runs it from source, with hot reload. Elsewhere the
  showcase-studio plugin runs the packaged app. Details:
  [docs/architecture.md](docs/architecture.md).
- To show the user one showcase, call `studio_start` with
  `showcase: <id>`. Leave it out only for the whole library.
- **Never add a studio (`dev` or `dev:electron`) to `.claude/launch.json`.**
  It lists only the marketing site (`site` and `site-wrangler`). A
  preview-button studio would be a second studio on the same library: the
  tools wouldn't use it, and its commits would sweep up the session's work
  in progress.
- From source, each `studio_start` runs the code as it is then. After
  changing server code, `studio_stop` then `studio_start`. A changed
  tool's inputs still need an MCP reconnect.
- To try a worktree's changes, pass `studio_start` `source: <worktree>`.
  It needs its own `node_modules`.
- One studio per library. If another studio has the library open,
  `studio_start` starts nothing and says to offer the user a git worktree.
- Claude's studio has auto-commit off; the session commits with
  `commit_showcase`. Its embedded terminals are off too (run `npm run dev`
  in a terminal for those).

## Where things live

| Path                                          | What's there                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `showcases/<id>/`                             | One folder per showcase: `showcase.yaml` (the script), optional `theme.yaml` and `cover.yaml`, `assets/`. Found automatically.                                                                   |
| `src/content/`                                | Loading showcases (`showcases.ts`), the showcase.yaml schema (`showcase-schema.mjs`), where data comes from (`source.ts`), shared rule files (`*-rules.mjs`).                                    |
| `src/components/showcase/`                    | The player and `ShowcaseFrame`, the frame around a showcase's screens.                                                                                                                           |
| `src/components/script/`, `share/`, `studio/` | The script page, the Share page, the studio panels.                                                                                                                                              |
| `src/routes/`                                 | TanStack Router file routes.                                                                                                                                                                     |
| `server/`                                     | The studio: every feature, in plain Node, unit-tested and gold-traced. `studio-server.mjs` is the request handler; `mcp.mjs` the MCP tools; `mcp-stdio.mjs` the stdio server Claude Code starts. |
| `electron/`                                   | Packaging only: the window, menus, the offscreen renderer, the preload.                                                                                                                          |
| `scripts/`                                    | `dev.mjs`, the export scripts, packaging, `vendor-whisper.mjs`.                                                                                                                                  |
| `plugins/showcase-studio/`                    | The Claude Code plugin: launcher, installer, the `/showcase-studio:showcase` skill.                                                                                                              |
| `web/prompter/`                               | The shared-teleprompter site.                                                                                                                                                                    |
| `cdk/`                                        | AWS: the teleprompter site and the license service.                                                                                                                                              |
| `site/`                                       | The marketing site, https://showcasestudio.dev.                                                                                                                                                  |
| `rehearsal/`, `scripts/rehearsal/`            | The release rehearsal (the `rehearsal` skill).                                                                                                                                                   |
| `gold_traces/`, `cdk/gold_traces/`            | AppMap gold traces (the `appmap-gold-traces` skill).                                                                                                                                             |
| `src/assets/`                                 | Shared UI assets only (the App Store badge).                                                                                                                                                     |

## Rules about structure

- No studio feature lives in `electron/`. Electron code may import from
  `server/`, never the reverse.
- In every mode the page reaches the studio over HTTP (`src/lib/studio.ts`).
  Every in-app edit names the content hash it was made against
  (`baseHash`), so the studio refuses to patch a file that changed
  underneath the page. Every in-app write goes through
  `server/scene-edit.mjs`.
- YAML edits use `parseDocument` + `setIn` (`server/edit-yaml.mjs`),
  never parse-and-redump: comments in showcase files carry real
  information.
- Which AWS profile pays for a synthesized voice is the user's choice. A
  session asks; it never picks one.
- Everything the studio serves answers only requests from this machine.
- `web/prompter` must never pull in the content layer (bundled showcases,
  YAML, themes). That's why `ScriptPlayer` imports the timing model
  directly.
- A new showcase screen gets its place in `ShowcaseFrame`'s `PLACES` list,
  one line each. Capture pages (`/export`, `/record`, `/cover/still`)
  don't use the frame.
- Screenshots and exports draw pages with Google Chrome when installed:
  Playwright's bundled Chromium can't play MP4 video.
- When server code changes, the running studio doesn't see it until it
  restarts. User-facing banners say only to restart, never which files.
- Marketing site: only routes in the `pages` list in `site/vite.config.ts`
  are built, so add a new route there, and a line to
  `site/public/sitemap.xml`. Text changes are YAML edits in
  `site/content/*.yaml`. Check each Features claim against the studio
  before adding it. Subscription questions go on the Pricing page, not
  the FAQ. Its Pricing links (`site/src/license-service.ts`) are prod:
  real money. There is no YouTube link yet; add one to the top bar and
  footer when the channel exists.
- Plugin releases: bump `package.json` and `plugins/showcase-studio/app-version`
  together for a new app, and `plugin.json`'s version for every plugin
  change (that's what `claude plugin update` looks at). The skill holds
  session steps only; how showcases work stays in
  `server/showcase-guide.mjs`.

## Conventions

- Slide designs are a fixed set of layout themes (`statement`, `feature`,
  `console`, `footage`) defined in `SceneView.tsx`. Don't style individual
  scenes ad hoc; add or change a theme instead, and document it in
  `showcases.ts`. Narration lives in captions only. Titles are on-screen
  text, never spoken or timed. A theme linter warns on legacy or
  incoherent themes but always renders.
- The player (`ShowcasePlayer.tsx`) stacks its rows under the top bar: the
  stage (with the transcript beside it), the scrubber (`Scrubber.tsx`),
  `StageControls.tsx`, then the scene rail with the view switch and
  transport. Controls that change how the current view renders or plays
  go in the rows between the stage and the scene rail: today the
  scrubber, the TikTok Safe area switch, the Frame button and the current
  scene's picture fit (`media.tiktok`). Future ones, such as playback
  speed, go there too, not in the bottom bar.
- The TikTok view and the `video` / `video-draft` exports are 9:16
  (1080×1920). App Screens and the screenshot export stay 1320×2868 (App
  Store 6.9"). Each picture's TikTok fit is in `src/content/tiktok-fit.ts`,
  with rules shared with the edit tool in `tiktok-fit-rules.mjs`.
  `TikTokSafeArea.tsx` draws what TikTok's interface covers, and the
  caption presets in `SceneView.tsx` are measured against the same areas.
- Asset keys are file names without extension: `asset: shot-mirror` is
  `assets/shot-mirror.png` in that showcase's folder. There is no registry.
  All screenshots are plain image files in the showcase's own `assets/`.
- The brand mark (`meta.watermark`, with a per-scene `watermark`
  override) is resolved in `src/content/watermark.ts` and drawn by
  `SceneWatermark.tsx` inside each canvas's stage, so every view and
  export gets it from one place. It is a corner mark by design: no banner
  position. The App Store badge belongs in a scene's `cta`.
- A showcase cut from a recording says so once, in `meta.source`, and each
  scene names its span in `take`. Everything else (the voiceover, clips,
  word timings, every `durationMs`) is derived by the build, which the
  studio runs on its own when the list changes. Nothing in the player
  knows about `take`. When a change adds something an author would
  otherwise work out by hand, it belongs in the cut list, not in a script
  beside the library.
- Per-showcase styling goes in `showcases/<id>/theme.yaml`: a whitelisted
  set of `colors`, `fonts`, `shape` and `atmosphere` overrides. The
  whitelist is `src/content/theme-rules.mjs`, shared by the loader and
  the studio's theme edits (the style panel and Claude's `edit_theme`):
  add a new theme key there. Like a showcase.yaml field, a theme problem
  is a warning, never a showcase that fails to load. A theme
  can `extends` another showcase's theme, and `fonts.load` lists font
  stylesheets. Structural CSS variables can't be overridden. `meta.theme`
  in showcase.yaml still works as a flat override on top. Don't fork
  component styles per showcase.
- A showcase's cover (the still image TikTok, Instagram and Shorts show
  before the video plays, and the regular YouTube video's 16:9 thumbnail,
  `youtube43`) goes in `showcases/<id>/cover.yaml`: a default plus
  overrides per destination, like the `publish:` block. Each destination's
  frame size and file type are in `COVER_DESTINATIONS`; nothing else
  assumes 9:16. Sizes in a cover are measured against the frame's shorter
  side, so one default serves both shapes. A 16:9 cover of a portrait
  picture is split unless its own block sets a layout. Only the page
  knows the picture's shape, so the page measures it (`useCover`). Its fields
  and layouts are `src/content/cover-rules.mjs`, shared by the loader,
  the Cover page's edits and Claude's `edit_cover`: add a new field
  there. A cover problem is a warning, never a showcase that fails to
  load. Layouts are a fixed set drawn by `src/components/cover/CoverView.tsx`;
  anything beyond the headline is a TSX graphic, not a new field. The
  video never reads the cover, and the cover is not a build input.
- In-app editing: pause to edit. Edits are structured patches to a
  whitelist of fields, not a generic YAML editor. They apply to the
  in-memory model first (`applySceneEditLocal` + `useShowcase`), then go
  to the studio's `scene-edit` action. Undo is Cmd/Ctrl+Z
  (`src/lib/edits.ts`), per showcase, for the session.
- Git history: when the library is in a git repository, the studio
  commits each showcase's changes after a quiet period
  (`server/showcase-history.mjs`). Its own writes are committed after
  5 s. A change made outside the studio is committed too, after 30 s
  with no further change in that showcase. The "Commit changes
  to git" switch (the gear in the top bar) turns it on and off for the
  whole studio. It is off by default in Claude's studio.
- A change on disk to one showcase reaches the page as `showcase-changed`
  and is re-read in place, so the page keeps its state. Only a change to
  the library itself reloads the page.
- A whole-library setting goes in the library's `showcase_settings.yaml`
  (read through `server/library-config.mjs`). Don't add a second
  library-level file, and don't put settings in `.studio/` (it's
  gitignored; settings should be committed). When you add a setting, add
  a commented line to `SETTINGS_TEMPLATE` and describe it in
  `server/showcase-guide.mjs`. Existing libraries keep the file they
  have, so the guide is how their sessions learn about it.
- **A new showcase.yaml field goes in `src/content/showcase-schema.mjs`
  first.** The loader warns about fields the schema doesn't know, so a
  reader added without the entry makes every showcase using it warn. A
  one-line `description` there says what the field is for; the guide says
  when to use it.
- What an author has to know (a theme, a media rule such as "footage is
  always muted", a caption style, a workflow like the recorded-pitch
  recipe) lives in `server/showcase-guide.mjs`, written to
  `<library>/.studio/GUIDE.md` on every launch. Update it in the same
  commit as the change. A session that had to read a sibling showcase or
  this source to learn a workflow means the guide is missing a section.
- Sharing uses none of the platforms' APIs. The studio gets the video and
  text ready; the user posts on the platform's upload page or from their
  phone. Post text lives in showcase.yaml's `publish:` block (a default
  plus `tiktok`, `instagram`, `youtube` for the Short, and `youtube43`
  for the regular 4:3 video; each override stands on its own), edited
  with `publish.set`. Limits are in `src/content/publish-rules.mjs`. The
  Share page must work fully in a browser and in Claude Code's preview:
  anything a page can't do (opening the upload page, copying, AirDrop,
  revealing the file) goes through the studio server. Only dragging the
  file out of the window is desktop-only.

## Branches

- Name a branch for the kind of change: `fix/<short-name>` for a bug fix,
  `feature/<short-name>` for something new, for example
  `fix/new-showcase-library`.
- The same goes for a worktree's branch. Claude Code's EnterWorktree tool
  names the branch `worktree-<name>`, so make the worktree with git
  instead, then move the session into it (EnterWorktree with `path`):

  ```sh
  git worktree add -b fix/<short-name> .claude/worktrees/<short-name> origin/main
  ```

## Committing

- When building a commit, never modify, move, or delete files on disk to
  control what goes into it: no setting files aside, no temporary edits,
  no triggering regeneration. The working tree must be byte-identical
  before and after preparing a commit.
- To commit a subset of the pending changes, stage selectively instead:
  whole files with `git add <path>`, and individual hunks within a mixed
  file by applying a filtered patch with `git apply --cached`.
