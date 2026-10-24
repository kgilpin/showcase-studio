# Development guide

## Setup and commands

Requires Node.js and npm, through [Volta](https://volta.sh)
(`brew install volta && volta setup`), which uses the version pinned in
package.json. `onboarding.yaml` lists every setup step.
Node 22 is required — a bare `node` on PATH can resolve to an ancient
version (v12 has appeared in shells here, which can't even parse the
server modules), so run checks through the npm scripts or Volta's Node
(`volta run node …`). `npm i` and `npm run dev` check first
(scripts/check-node.cjs, from package.json's `engines`) and stop with a
plain message on anything older.

```sh
npm i            # install dependencies (the browser studio, exports, tests)
npm run setup:desktop
                 # + the Electron shell's own dependencies (electron/
                 # package.json → electron/node_modules): only dev:electron,
                 # package:desktop and release:desktop need them, so a plain
                 # npm i skips Electron. (Electron fetches its 300 MB binary
                 # on first use, so setup itself is quick.)
npm run dev      # the full studio in your browser (modes below)
npm run build    # production build
npm run preview  # serve the production build locally
npm run lint     # eslint
npm run format   # prettier --write .
npm test         # vitest (slide timing model)

npm run vendor:whisper             # put whisper.cpp's whisper-cli in
                                   # electron/vendor/whisper/ (gitignored),
                                   # which the packaged app ships and the
                                   # studio runs for voice-to-text. Built
                                   # from source on macOS (needs cmake for
                                   # this Mac's architecture — an Intel
                                   # cmake under Rosetta is refused, since
                                   # it can only make an x86_64 binary);
                                   # downloaded from one pinned,
                                   # checksummed whisper.cpp build on
                                   # Windows. Runs as part of
                                   # package:desktop and release:desktop,
                                   # and leaves an existing binary alone
                                   # (-- --force replaces it). The speech
                                   # model is separate: the studio
                                   # downloads it on first transcription.

npm run export:screens             # capture App Store screenshots for every
npm run export:screens -- <id>     # showcase (or one) to exports/<id>/
                                   # (needs a studio running: pass the URL it
                                   #  prints as BASE_URL; first time:
                                   #  npx playwright install chromium — or use
                                   #  npm run dev -- --export screens:<id>)
                                   # App Screens presentation: slide titles
                                   # shown, captions off

npm run export:video               # render every showcase (or one) as an MP4
npm run export:video -- <id>       # to exports/<id>/video.mp4 — frame-by-frame
                                   # at 1080×1920 (TikTok's 9:16), 30 fps
                                   # (slow but exact)
                                   # Video presentation: captions overlaid on
                                   # the media, slide titles hidden
npm run export:video -- --realtime # quick 360×640 draft (video-draft.mp4)
npm run export:video -- --prompter # record the teleprompter (/script page)
                                   # instead: 1280×720 real-time draft to
                                   # exports/<id>/prompter-draft.mp4
                                   # (needs the dev server running)

npm run build:prompter             # build the shared-teleprompter site
npm run dev:prompter               # (web/prompter) — dev server on :8097;
                                   # /p/sample serves the checked-in fixture

# Deploy the prompter site (cdk/): builds must exist first. Same
# environment convention as the siteforward stack (-c environment=dev|prod,
# dev default → ShowcasePrompterStack-Dev / -Prod); dev is free to push.
#   cd cdk && npm install
#   AWS_PROFILE=siteforward npx cdk deploy -c environment=dev
# The studio publishes to Prod by default (PROMPTER_PUBLISH_URL in
# server/studio-server.mjs); prompterPublishUrl in the studio settings
# points one machine at Dev.

# The marketing site (site/), live at https://showcasestudio.dev: a
# TanStack Start app, prerendered to static files at build time and served
# by a Cloudflare Worker. Its own npm package, nothing shared with the
# studio's build or the AWS stack.
#   cd site && npm i
#   npm run dev            the site with hot reload on http://localhost:8098
#                          (PORT when a launcher sets it)
#   npm run build          prerender into site/dist/client (gitignored)
#   npm run typecheck      tsc
#   npm run dev:wrangler   build, then serve dist/client the way Cloudflare
#                          does, with /download/* from wrangler's local R2
#                          bucket
#   npm run publish-release -- <mac|win> <version> <folder> [--local]
#                          put a release's zip and checksum file in the R2
#                          bucket showcase-studio-releases and point
#                          /download/latest/<mac|win> at it (--local: the
#                          bucket dev:wrangler serves). The studio-release
#                          skill runs it.
#   npm run media          make site/public/media from the repo: the hero
#                          video from the showcase-studio export, the two
#                          NOVA example frames from the nova export, and
#                          the teleprompter picture. Export first, at
#                          the root: npm run dev -- --export
#                          video:showcase-studio, and --export
#                          video-draft:nova. Commit the results.
#   npm run capture:prompter
#                          capture the NOVA teleprompter picture into
#                          site/media-src/ from a studio on :8123 (start
#                          one at the root: PORT=8123 npm run dev --
#                          --no-terminal --no-auto-commit --alongside)
# Deploy (the Worker "showcase-studio", from site/wrangler.toml):
#   npx wrangler login     once, in a browser, as the account that holds
#                          the showcasestudio.dev zone (npx wrangler whoami
#                          says which account you are in)
#   npm run deploy         build, upload site/dist/client, serve it at
#                          showcasestudio.dev (until the move: both
#                          deploys below)
#   npm run deploy:preview build and upload a version without serving it
# wrangler.toml names no account, so a deploy goes to whichever account
# wrangler is logged in to. The domain is in the goo.global account and
# moves to the SiteForward account around 2026-10-26. Until then:
#
#   showcasestudio.dev ── /download/* ──► showcase-studio-downloads ──► R2 bucket
#   (goo.global Worker,                   (SiteForward Worker on       showcase-studio-
#    no bucket)                            workers.dev)                releases
#
# A Worker can only read a bucket in its own account, so the site's Worker
# relays downloads to the same worker.js deployed beside the bucket.
# wrangler login is SiteForward; goo.global is the wrangler auth profile
# "goo" (npx wrangler auth create goo). npm run deploy runs both deploys:
#   wrangler deploy --env goo --profile goo      the site, in goo.global
#   wrangler deploy --env downloads              the downloads Worker, in
#                                                SiteForward
# Releases upload to the SiteForward bucket only (publish-release, as is).
# After the move, switch back with the five steps at the end of
# site/wrangler.toml: the plain deploy scripts in site/package.json, no
# env sections or relay, npm run deploy as SiteForward, delete the two
# Workers that are no longer used, then deploy on every push to main
# with a GitHub Actions workflow. Until then the site deploys by hand
# (npm run deploy): nothing deploys it on push.
# wrangler remembers the account in
# site/node_modules/.cache/wrangler/wrangler-account.json: after logging
# in as another account, delete that file, or wrangler keeps sending
# requests to the old account ("Authentication error [code: 10000]").
# wrangler refuses to run below a folder holding a stale
# .wrangler/deploy/config.json (an old studio build can leave one at the
# repo root, pointing at .output/server/wrangler.json): delete that folder.

npm run export:script              # print every showcase's narration script
npm run export:script -- <id>      # (or one) as plain text to stdout — the
                                   # same spoken lines as the /script page.
                                   # Reads the YAML directly; no dev server.

npm run package:desktop            # package the desktop shell as a runnable
                                   # app (dist-electron/dist/mac-arm64/
                                   # Showcase Studio.app): builds the app as a
                                   # Node server with the data URL baked in
                                   # (build:desktop), stages runtime files +
                                   # deps into dist-electron/app
                                   # (scripts/package-desktop.mjs), then runs
                                   # electron-builder. The packaged app runs
                                   # the built app and the studio server
                                   # in-process on free ports, so any number
                                   # of studios can run at once. From Finder,
                                   # a second instance needs `open -n`.
npm run release:desktop            # the same, as the release: a signed,
                                   # notarized zip + SHA256SUMS in
                                   # dist-electron/dist/, named as the
                                   # plugin's install-app downloads them.
                                   # Needs the Developer ID Application
                                   # certificate in the keychain and the
                                   # notarization credentials in the
                                   # environment (electron-builder.yml
                                   # lists them); without them it still
                                   # builds, signed for this Mac only.
                                   # Check: spctl -a -vv <app> says
                                   # "accepted" / "Notarized Developer ID".
                                   # The whole release — version bump, this
                                   # build, tag, the Windows CI build, the
                                   # upload to showcasestudio.dev/download,
                                   # the GitHub release (kept as the
                                   # record), the install check — is
                                   # the /studio-release skill
                                   # (.claude/skills/studio-release).
npm run build:icon                 # render the app icon: build/icon.svg (the
                                   # source, on Apple's 1024/824 icon grid)
                                   # → build/icon.png, which electron-builder
                                   # turns into the .icns and dev:electron
                                   # sets on the Dock. Run after editing the
                                   # SVG and commit both files.

npm run dev                        # the studio from source (scripts/dev.mjs):
npm run dev:electron               # Vite with the studio server mounted in
                                   # it, so the page, the library data, the
                                   # studio API and MCP share one port (PORT
                                   # when a launcher sets it, else a free
                                   # one; printed as "studio: <url>").
                                   #   dev           the full studio, in a browser
                                   #   dev:electron  the same, in an Electron
                                   #                 window (+ system menus)
                                   # The library defaults to this repo's
                                   # showcases/ (--library picks another). It
                                   # is scaffolded with a README, .gitignore
                                   # and CLAUDE.md, and .studio/GUIDE.md is
                                   # rewritten on every start. Pages reload
                                   # when library files change outside the
                                   # studio. Screenshots and exports draw
                                   # pages with Playwright (Google Chrome when
                                   # installed — its bundled Chromium can't
                                   # play MP4 video).
                                   # One studio per library: a studio notes
                                   # its address in .studio/studio.json, and
                                   # npm run dev (or the app, or File > Open
                                   # Folder) refuses a library whose noted
                                   # studio still answers there, naming the
                                   # address. A crashed studio can't answer,
                                   # so the note it leaves never blocks.
                                   # --export runs skip the check (they run
                                   # beside an open studio). Claude's
                                   # studio_start doesn't refuse: it starts
                                   # nothing and tells Claude to offer the
                                   # user a git worktree (a separate copy
                                   # with its own studio), or, outside git,
                                   # to ask — two sessions on the same files
                                   # end badly, whoever started the other.

npm run dev -- --help              # every option (the packaged app takes the
                                   # same: open -n "Showcase Studio.app"
                                   # --args <options>). Settings are flags,
                                   # not environment variables.

npm run dev -- --open <showcase folder>
npm run dev -- --new [<library folder>]
                                   # lock the studio to one showcase: --open
                                   # shows that showcase (its parent folder
                                   # is the library); --new shows the New
                                   # showcase page (/new) until it creates
                                   # one, then locks to it. No Home link, no
                                   # File > Open Folder / Open Recent, and
                                   # navigation outside the showcase goes
                                   # back to it.

# Claude Code starts a studio of its own, through an MCP server on stdio
# (server/mcp-stdio.mjs) that owns the studio process, with the Claude
# terminals off. Its studio_start tool starts it — optionally locked to a
# showcase — and returns the URL to open (e.g. in the Claude Code
# preview); studio_stop stops it, and it stops with the Claude Code
# session. Nothing to find, no port configured. stdout is the MCP channel,
# so all other output goes to stderr. Two ways in:
#   in this repo    .mcp.json runs scripts/studio-mcp.mjs: the npm run dev
#                   studio, from source
#   anywhere else   the showcase-studio plugin (plugins/showcase-studio/,
#                   listed in .claude-plugin/marketplace.json) runs the
#                   packaged app with --mcp. studio_start {window: true}
#                   opens the app's own window; without it the app runs
#                   with no window or Dock icon. The plugin's
#                   /showcase-studio:showcase skill is a working session:
#                   start the studio, read the guide, edit, check.
#                   Try it in a library folder on a local build:
#                     SHOWCASE_STUDIO_APP=<repo>/dist-electron/dist/mac-arm64/Showcase\ Studio.app \
#                       claude --plugin-dir <repo>/plugins/showcase-studio
#                   Or from source: set SHOWCASE_STUDIO_SRC=<repo> (e.g. in
#                   the library's .claude/settings.local.json "env") and the
#                   plugin runs scripts/studio-mcp.mjs with Node 22 instead.
#                   Its library defaults to the folder Claude Code runs in
#                   (or a showcases folder inside it), never the app's last
#                   folder or ~/Showcases. When that folder holds other
#                   files, or is the home folder, studio_start starts
#                   nothing and answers {started: false, chooseLibrary,
#                   next}, so Claude asks the user
#                   (libraryForClaude in server/launch-options.mjs).
# The preview shows the studio the MCP tools started: Claude opens
# studio_start's URL. To show the user one showcase, call studio_start
# with showcase: <id>, which locks the studio to it (no Home link); leave
# it out only for the whole library. Libraries have no
# .claude/launch.json, and this repo's lists only the marketing site
# ("site", npm run dev on :8098, and "site-wrangler", npm run
# dev:wrangler) — never a studio (dev or dev:electron). A
# preview-button studio would be a second studio on the same library: the
# tools wouldn't use it, and its commits would sweep up the session's work
# in progress. (The studio removes the ones earlier versions wrote into
# libraries.) For UI work, studio_start's studio is already the npm run
# dev studio from source, with hot reload.
# From source, the studio runs as a child process of the MCP server
# (server/child-studio.mjs runs scripts/dev.mjs), so each studio_start
# runs the code as it is then: after changing server code, studio_stop
# then studio_start picks it up. To try a git worktree's changes, pass
# studio_start source: <worktree>; its showcases/ is the default library,
# and it needs its own node_modules. (The tool list itself is read when
# the session starts: a changed tool's inputs still need a reconnect.)
# For the embedded terminals, which Claude's studio turns off, run
# npm run dev in a terminal.
```

## Where things live

- `showcases/<id>/`: One folder per showcase: `showcase.yaml` (the script),
  optional `theme.yaml` (styling), and `assets/` (its screenshots). Folders
  are discovered automatically.
- `src/content/showcases.ts`: Generic loader: parses each showcase's YAML,
  resolves asset keys (file name without extension) to URLs, and resolves
  each showcase's theme (whitelist, `extends`, font loads). Documents the
  scene/theme model.
- `src/content/source.ts`: Where the showcase data comes from: folders
  bundled at build time (default, SSR-safe), or the same files fetched over
  HTTP when `VITE_SHOWCASES_URL` is set (every studio mode sets it to
  `/showcase-data`, which the studio server serves from the library folder).
  Folder TSX graphics are compiled server-side (esbuild) and loaded by
  `src/content/graphics-runtime.tsx`; the folder wins over a bundled graphic
  with the same key.
- `src/components/showcase/`: The player: `ShowcasePlayer`, `SceneView`
  (slide layouts), `SceneMedia` (motion), `ProgressRail`, `Soundtrack`.
- `src/components/script/`: The script page: script listing and
  teleprompter.
- `src/routes/`: TanStack Router file routes: `/` (home), `/new` (the New
  Showcase page, studio only), `/showcase/$showcaseId` (+ `/script`,
  `/assets` — the media collection with usage and studio-side rename,
  `/share` — posting the video to TikTok, Instagram and YouTube Shorts,
  studio only, its parts in `src/components/share/`, `/export`,
  `/export/$sceneId`, `/record`).
- `scripts/export-screens.mjs`: Playwright script that screenshots each
  export page at 1320×2868 (App Store 6.9"). Scenes with `export: false` are
  skipped.
- `scripts/export-video.mjs`: Playwright script that renders each showcase's
  `/record` page to an MP4 — frame-by-frame via `window.__record.seek()` by
  default, or a real-time screen recording with `--realtime`.
- `scripts/export-script.mjs`: Prints a showcase's narration script as plain
  text (the same spoken lines as the `/script` page), straight from the YAML
  — no server or browser needed.
- `src/assets/`: Shared UI assets only (App Store badge). Showcase
  screenshots live in each showcase's own `assets/` folder.
- `server/`: The studio. Every feature, in plain Node (no Electron imports),
  unit-tested and gold-traced:
  - `studio-server.mjs`: `createStudio()`: one request handler that the Vite
    dev server (`scripts/dev.mjs`) and the packaged app both mount —
    `/showcase-data` (the library's files), `GET /studio/api/info`,
    `GET /studio/api/history` (the git history status, for the "Commit
    changes to git" switch), `GET /studio/api/events` (server-sent events:
    reload, info, export progress, build progress, terminal output),
    `GET /studio/api/export-video` (a recorded export's video for the Share
    page's preview, streamed in byte ranges), `POST /studio/api/<action>`
    (scene-edit, showcase-create, asset add/rename/delete, prompter-publish,
    history-auto-commit, export jobs, media builds, share
    status/hand-off/post link/reveal/copy, library switch, terminals) and
    `/mcp`; everything it serves — library files, API, events, MCP — only
    answers requests made on this machine, and the dev server listens on
    localhost only. It also scaffolds the library (README, CLAUDE.md,
    `.studio/GUIDE.md`, `.studio/mcp.json`), watches it and tells pages to
    reload on outside changes — its own in-app writes are recognized by
    content hash and swallowed, so edits update the page in place — and runs
    the MCP tools in-process through `callTool`, for the studio Claude Code
    starts.
  - `mcp-stdio.mjs`: the MCP server over stdio that Claude Code starts:
    `studio_start` (with a `window` choice where the program can show one,
    and a `source` choice from source) and `studio_stop`, one studio at a
    time, stdout kept for MCP messages. When another studio already has the
    library open, `studio_start` — and any other tool's first-use start —
    starts nothing and answers `{started: false, alreadyOpen, git, next}`:
    in git, a worktree offer with the commands filled in and what the copy
    won't have, from `library-git.mjs` (showcase files git doesn't track,
    uncommitted changes); outside git, a question for the user.
    `alongside: true` is the user's choice of a second studio on the same
    files, remembered for restarts (from source it passes `--alongside` to
    `dev.mjs`, which would otherwise refuse the library); run by
    `scripts/studio-mcp.mjs` from source — which starts each studio as a
    child process, `child-studio.mjs` running
    `<source>/scripts/dev.mjs --no-terminal --no-auto-commit`, so every
    start runs current code — and by the packaged app's `--mcp`, in-process.
  - `mcp.mjs`: the MCP tools: `studio_info` (with `pageError` when the last
    server-side page render failed and none has rendered since — recorded by
    `src/start.ts`/`src/server.ts` in `src/lib/page-error.mjs`, a store on
    `globalThis` that both the page's server code and the studio read in the
    same process; `validate` and `screenshot_slide` quote it, and the error
    page shows it under Details only while a studio runs in the process and
    the request names a local host), `edit_showcase` through
    `scene-edit.mjs`, `add_asset` through `asset-files.mjs` (files on disk
    copied into a showcase's `assets/` — what an image dropped into the
    Claude chat or a screenshot Claude captured goes through; the page's
    drop target is the same module's base64 door), `commit_showcase` through
    `showcase-history.mjs`, `screenshot_slide`, `validate`, `transcribe`
    (with `save`, which writes the recording's editable transcript),
    `script`, `build_media`/`build_status`/`build_cancel` through
    `build-media.mjs`, `build_voiceover` through `voiceover.mjs`, `export`/`export_status`/`export_cancel`,
    `share_status`/`share`/`share_record` through `share.mjs`.
  - `export-records.mjs`: a record of each video export, full quality and
    draft, with how long it took to render (the next export's time
    estimate), one JSON file each in
    `<library>/.studio/exports/<showcase>/`, written whole under a temporary
    name and renamed into place, so no lock is needed: the file's path,
    size, length and a fingerprint of what it was made from — showcase.yaml
    without its `publish:` block, the theme and any theme it extends, the
    files in `assets/` and `graphics/`, the app version — taken when the
    export starts, so the Share page knows whether the video still matches
    the showcase; a record finds a video the next export moved into the
    export folder's `history/` by its size and modified time, and is dropped
    when its video is gone; the videos stay in Downloads.
  - `share.mjs`: sharing without the platforms' APIs: the Share page's
    status — each destination's text from showcase.yaml's `publish:` block
    with the rules in `src/content/publish-rules.mjs`, the exports, the
    hand-offs — plus hand-off records in
    `<library>/.studio/publishes/<showcase>/`, post links checked to be on
    the platform's own site, and opening a page in the user's browser and
    copying to the clipboard from the server, which is what makes them work
    in Claude Code's preview, where the page may not use the clipboard.
  - `airdrop.mjs`: a Mac's AirDrop window for a file, opened from the server
    with a small JavaScript for Automation script, so "Send to phone" works
    in the browser and the preview, not only the desktop app.
  - `yaml-text.mjs`: writes an edited YAML document back without disturbing
    what the edit didn't touch: long lines stay unwrapped, and unchanged
    folded (`>`) and literal (`|`) blocks keep their original text.
  - `build-plan.mjs`: the cut list a recorded pitch is described by:
    `meta.source` names the master recording and each scene's `take` names
    the span it owns — reading it, checking that a scene's picture and sound
    last the same, and pinning every scene's duration on a cumulative 10 ms
    grid so the pins add up to the track built from the same spans.
  - `build-media.mjs`: the build: the spans joined into the voiceover, one
    muted clip per footage scene, the master transcript remapped into the
    words file, and every `durationMs` written back through `scene-edit.mjs`
    — so nothing is copied across by hand and the picture cannot drift from
    the voice; idempotent through a fingerprint of each output's inputs in
    `<library>/.studio/build/<showcase>.json`.
  - `voiceover.mjs`: a synthesized voiceover, for a showcase with no
    recording: `meta.voiceover` names the AWS Polly voice and engine (and,
    optionally, the AWS profile and region), and the build reads each
    caption aloud through the `aws` command, so the user's own sign-in
    works. Each caption gets a window — 250 ms lead, the clip rounded up
    to the millisecond, 450 ms tail, the last one 1.5 s more — joined
    from 24 kHz PCM into `assets/<track>.m4a`, so the `durationMs` pins it
    writes through `scene-edit.mjs` add up to the track exactly. Whisper
    hears each clip on its own for `assets/<track>.words.json`, its times
    fitted to where the clip is voiced. Clips (and what whisper heard) are
    cached in `<library>/.studio/build/voiceover/<showcase>/` by voice,
    engine and text, so only a changed caption calls Polly again. It runs
    in the media-build lane: `build_voiceover`, the `voiceover` action,
    and a plain `build` (the Build media button) of a showcase with
    `meta.voiceover`.
  - `transcript.mjs`: the recording's editable transcript,
    `assets/<recording>.transcript.json`: whisper's sub-word tokens merged
    into whole words, and a `corrections` list — respell a word, fold two
    into one, move one whisper placed early — re-applied after every
    re-transcribe, so a fix is never lost; `sliceTranscript` remaps it onto
    a cut's timeline.
  - `ffmpeg.mjs`: the bundled binary, plus reading a file's duration and
    loudness back out of its stderr — ffmpeg-static ships no ffprobe.
  - `git-program.mjs`: git's full path, found once and reused by the
    history and `library-git.mjs`: started by its bare name, every git
    command paid a search along PATH (40–50 ms on a Mac, against 6 ms).
  - `exporter.mjs`: screens, video and script exports, slide screenshots and
    validate, drawn by a page renderer — `renderer-playwright.mjs` from
    source, Google Chrome when installed; Electron's in the packaged app —
    and encoded with the bundled ffmpeg.
  - `terminals.mjs`: per-showcase Claude Code terminals: one persistent
    node-pty per showcase with its folder as cwd, `claude --continue`
    resume, integrated xterm panel or external Terminal.app,
    `SHOWCASE_STUDIO_SRC`/`ROOT`/`FFMPEG` env vars; off in the studio Claude
    Code starts; the npm `postinstall` restores node-pty's spawn-helper exec
    bit.
  - `transcribe.mjs`: whisper.cpp voice-to-text: the binary ships with the
    app in `electron/vendor/whisper/` — `scripts/vendor-whisper.mjs` builds
    it on macOS and downloads a pinned, checksummed build on Windows,
    `package-desktop.mjs` refuses to package without it, and
    `server/whisper-binary.mjs` is the one place its name and path are
    decided; the speech model still downloads on first use.
  - `settings.mjs`: settings.json in the studio data folder.
  - `showcase-data.mjs`: the folder-serving data shape: index.json, yaml,
    assets with byte-range support, TSX graphics compiled on request.
  - `edit-yaml.mjs`: comment-preserving YAML field edits — parseDocument +
    setIn, never parse-and-redump: the frontend's named ops plus whitelisted
    `scene.set`/`caption.set`/`meta.set`/`scene.move` for the MCP edit tool.
  - `scene-edit.mjs`: the write path for every in-app edit — showcase.yaml,
    or theme.yaml for style-panel edits: resolve, stale-`baseHash` gate,
    patch, `beforeWrite` hook, write, return the new content hash;
    `applySceneEditsToFolder` applies a batch of showcase.yaml edits as one
    all-or-nothing write.
  - `edit-theme.mjs`: the style panel's whitelisted theme.yaml edits:
    caption colors + stage background.
  - `export-output.mjs`: where finished exports go: the export folder holds
    only the newest of each kind, and older ones move into its `history/`,
    numbered from the newest.
  - `export-jobs.mjs`: cancellable background jobs — one lane for exports,
    one for media builds, so neither blocks the other.
  - `prompter-script.mjs`: the shared-teleprompter snapshot: narration
    lines + resolved timings only — what the studio publishes and
    `web/prompter` renders.
  - `showcase-guide.mjs`: the authoring guide rewritten to
    `.studio/GUIDE.md` every launch — the seeded CLAUDE.md imports it.
  - `launch-options.mjs`: the command-line options and their `--help` text,
    shared by `scripts/dev.mjs` and the Electron shell: `--open`/`--new`
    lock the studio to one showcase, plus `--library`, `--export`, and the
    switches the npm scripts set, `--electron`/`--app-url`; which pages are
    inside a lock — and which are capture pages that ignore it — is
    `src/lib/window-lock.mjs`, shared by the page, which hides Home and
    redirects, and the Electron window, which enforces it as a backstop.
  - `change-log.mjs`: `<library>/.studio/changes.jsonl`: one JSON line per
    write the studio makes on someone's behalf — page edits, asset
    add/rename/delete, new showcases as `"source":"ui"`, `edit_showcase` as
    `"source":"mcp"` — with the YAML file's content hash before and after,
    so a Claude session can follow the user's edits with `tail -F` and
    `edit_showcase`'s `ifVersion` can list what changed when it refuses a
    stale write; rotates to `changes.1.jsonl` rather than trimming, so
    `tail -F` never replays.
  - `showcase-history.mjs`: the studio's git history: when the library is
    inside a git work tree, each showcase folder is committed on its own
    after a quiet period (5 s, `commitDelayMs`) — `git add -A -- <folder>`
    then `git commit -- <folder>`, so the user's other staged work stays
    staged. Only the studio's own writes start the clock — they arrive
    through the change log (`onAppend`), never the file watcher — so an
    editor, a checkout or a Claude session's own file tools never start a
    commit; their changes ride along in the studio's next commit of that
    showcase as "files changed directly". In the studio Claude Code starts
    (`features.autoCommit: false`) the studio makes no commits of its own
    until the user turns the switch on; that off stops only the timer, and
    `commit_showcase` still commits — unlike the user's switch turned off,
    which stops both. Subjects name the changed files when they fit in 72
    characters and count them when they don't ("add 7 graphics"). Skipped
    when `git status` is clean for the folder, during a
    merge/rebase/cherry-pick/revert/bisect, on a detached HEAD, or while
    `index.lock` exists; never `--no-verify`. A library that isn't in a work
    tree gets `git init` the first time there is something to commit — never
    on open, never where a repository would take in far more than the
    library (`tooBigToInit`: a home folder, a volume root), and never when
    commits are off; git's "who are you" error becomes two commands to run
    (`noIdentityReason`); messages built from the change log plus the names
    of unexplained files, with a `Showcase-Studio: auto-commit` trailer;
    each commit is logged as a `"source":"studio"`, `"kind":"commit"` line;
    `autoCommit: false` in settings turns it off — the user sets it with the
    "Commit changes to git" switch
    (`src/components/studio/StudioSettings.tsx`, the gear button at the
    right of `ShowcaseNav`), which saves it through `history-auto-commit`,
    takes effect at once, drops commits still waiting, and logs a
    `"kind":"setting"` line; `studio_info`/`studio_start` report it as
    `history`.
  - `studio-presence.mjs`: one studio per library: a running studio notes
    its address in `.studio/studio.json`; before a studio opens a library it
    asks that address, not the file, whether a studio for that library is
    there — so a note left by a crash never blocks, and anything that doubts
    it (a timeout, an answer that isn't a studio's) counts the library as
    free; the note is removed on close only if it is still this studio's.
  - `library-config.mjs`: a root-level `showcase_settings.yaml` in a
    showcases folder, which the studio writes, all comments, into every
    library it opens — so it also marks the folder as a library: library
    settings, currently just `show_in_recent: false` to hide the folder from
    File > Open Recent; an older library's root `showcase.yaml` with no
    `scenes` or `meta` is renamed to it when a studio opens the library, and
    read until then.
- `electron/`: Packaging only. No studio feature lives here:
  - `main.mjs`: the desktop window: `npm run dev:electron` opens it on the
    dev server's studio with `--app-url`, and the packaged app starts the
    built app (`.output/`) and the studio server itself, on free ports;
    system menus — File > Open Folder…/Open Recent switch the studio's
    library through its API and are hidden when locked; a navigation guard
    that keeps a locked window on its showcase; `--export` in the packaged
    app; the `ELECTRON_SMOKE*` capture hooks.
  - `renderer.mjs`: the packaged app's page renderer: offscreen windows for
    screenshots and exports, which land in
    `~/Downloads/showcase-exports/<id>`.
  - `preload.cjs`: the window's extras:
    `window.showcaseStudioShell.pathForFile`, for files dropped on the
    terminal, and `startDrag`, which drags an exported video out of the
    Share page onto an upload page — `main.mjs` only drags an `.mp4` inside
    the export folder.

  Everything else the Share page does runs in the studio server, so it works
  the same in a browser and in Claude Code's preview. In every mode the page
  reaches the studio over HTTP (`src/lib/studio.ts`), and each in-app edit
  names the content hash it was made against (`baseHash`), so the studio
  refuses to patch a file that changed underneath the page. Panel UI in
  `src/components/studio/`. With `--mcp` (run by the showcase-studio plugin)
  the packaged app is Claude Code's studio instead: an MCP server on stdio
  (`server/mcp-stdio.mjs`) with no window or Dock icon until `studio_start`
  asks for a window, and closing that window leaves the studio running for
  Claude. Electron code may import from `server/`, never the reverse.

- `plugins/showcase-studio/`: The Claude Code plugin, listed in the repo's
  `.claude-plugin/marketplace.json`: `.mcp.json` runs `bin/studio-mcp`, a
  plain `sh` launcher (Claude Code doesn't need Node, so it can't either)
  that finds `Showcase Studio.app` (`SHOWCASE_STUDIO_APP`,
  `SHOWCASE_STUDIO_INSTALL_DIR`, `~/Applications`, `/Applications`), prefers
  the version in `app-version` — pinned separately from the plugin's own
  version, so the plugin can change without a new app release — and runs it
  with `--mcp`; `bin/install-app` installs that version from
  `https://showcasestudio.dev/download/v<version>/` (`curl`, SHA-256 check,
  into `~/Applications`; `SHOWCASE_STUDIO_DOWNLOAD_URL` points it at
  another site, such as a local `npm run dev:wrangler`), and
  the skill runs it when the studio tools are missing;
  `skills/showcase/SKILL.md` is the working session
  (`/showcase-studio:showcase <name>`): start the studio — in Claude Code's
  preview panel when there is one, otherwise in the app's window — read the
  library's `.studio/GUIDE.md`, edit through the studio's tools, and check
  each change before reporting it. The skill holds the session steps only;
  how showcases work stays in `server/showcase-guide.mjs`. Releasing: bump
  `package.json` and `app-version` together for a new app, and
  `plugin.json`'s version for every plugin change (that's what
  `claude plugin update` looks at).
- `web/prompter/`: The shared-teleprompter site: one static page that
  fetches `/scripts/<token>.json` (published by the studio's "Share
  prompter" button) and runs `ScriptPlayer` on a phone — camera takes save
  on the device, nothing comes back. Built with its own vite config
  (`npm run build:prompter`) so it stays thin: it reuses `ScriptPlayer` and
  the design system but must never drag in the content layer (bundled
  showcases, YAML, themes) — `ScriptPlayer` imports the timing model
  directly for this reason. `public/scripts/sample.json` is the dev fixture
  (`/p/sample`).
- `cdk/`: AWS infra for the prompter site (own npm package; deploy with
  `AWS_PROFILE=siteforward`): a private S3 bucket behind CloudFront
  (`/p/<token>` rewritten to the page at the edge; `/scripts/*` never
  cached; 30-day lifecycle on scripts) and one open Lambda publish endpoint,
  reached by its Function URL (`cdk/lambda/publish-core.mjs` holds the
  rules, `publish.mjs` wires them to S3). Anyone may publish: a new script
  gets a server-made token (the link) and an edit key, and only that edit
  key updates it; S3 keeps just the key's hash, as object metadata that
  CloudFront strips. Tokens are unguessable capability URLs — no login, no
  listing. The studio's `prompter-publish` action saves `{ token, editKey }`
  in settings `prompterLinks`, keyed by the showcase folder's full path, so
  re-publishing updates the narrator's existing link; a moved folder keeps
  its link when exactly one saved folder of the same name no longer exists,
  and an expired link is replaced by a new one (the share dialog says so).
  The endpoint defaults to Prod's; settings `prompterPublishUrl` or
  `PROMPTER_PUBLISH_URL` env points elsewhere.
- `site/`: The marketing site at https://showcasestudio.dev (own npm
  package): a TanStack Start app, prerendered by `vite build` into
  `dist/client`, which a Cloudflare Worker serves as static files, so no
  page is rendered on a request. Only the routes in the `pages` list in
  `vite.config.ts` are built, so a new route must be added there.
  `src/routes/__root.tsx` holds the shared `<head>` (title, description,
  Open Graph tags; each route sets its own canonical link),
  `src/routes/index.tsx` the home page, a short overview, and
  `src/routes/features.tsx` the Features page: seven sections, each a
  picture with numbered circles beside three features — check each claim
  against the studio before adding it. `src/routes/faq.tsx` is written
  but not published until pricing ships (`FAQ_LIVE` in
  `src/components/Site.tsx`). `src/components/Site.tsx` is the top bar and footer every page
  shares, and `src/components/` also holds the parts that run in the browser (the caption
  highlight, the hero video's player, the Copy button) and the
  destination logos. `src/styles.css` is the stylesheet. `worker.js` runs only for `/media/*`, to answer byte-range
  requests, which Safari needs to play the hero video, and for
  `/download/*`: the app's releases, from the R2 bucket
  `showcase-studio-releases` (zips are too big for static files, which
  Cloudflare caps at 25 MiB). The bucket holds `v<version>/<file>` for
  each release and `latest.json` (`{"mac": …, "win": …}`), which
  `/download/latest/mac` and `/download/latest/win` redirect by.
  `scripts/publish-release.mjs` uploads a release and writes
  `latest.json` last. The GitHub release stays as the private record of
  each build; users download from the site. `public/` is copied into
  the build as is: `_headers`, `icon.svg` and `media/` (made by
  `scripts/prepare-media.mjs`). Its download buttons
  link to `/download/latest/*`, so a release doesn't touch the page.
  There is no YouTube
  link yet: add one to the top bar and the footer when the channel exists.
- `gold_traces/`: The AppMap gold-trace baseline: `manifest.yaml` curates
  one lean, deterministic trace per subsystem (recorded from the tests via
  appmap-node) and `baseline/appmaps/` holds the blessed, sanitized
  recordings. Maintained with the `appmap-gold-traces` skill, installed for
  the user from [getappmap/skills](https://github.com/getappmap/skills) and
  not vendored here (the README's "The AppMap skills" says how); see that
  skill for the record → review → bless flow.

## Conventions

- Slide designs are a fixed set of layout themes (`statement`, `feature`,
  `console`, `footage`) defined in `SceneView.tsx`. Do not style individual
  scenes ad hoc; add or change a theme instead, and document it in
  `showcases.ts`. Narration lives in captions only — titles are on-screen
  text, never spoken or timed. A theme linter warns (diagnostics tray)
  on legacy/incoherent themes but always renders.
- The player (`ShowcasePlayer.tsx`) stacks its rows under the tab bar:
  the stage (the slide, with the transcript column beside it), then the
  scrubber (`Scrubber.tsx` — a slider over the current scene with a time
  counter; dragging pauses and moves the caption, the video and every CSS
  animation on the stage to that moment), then `StageControls.tsx`, then
  the scene rail with the view switch and transport. The rows between
  the stage and the scene rail are the place for controls that change
  how the current view renders or plays: today the scrubber, the TikTok
  view's Safe area switch and the current scene's picture fit (Fill /
  Fit, focus, bands — `media.tiktok`). Future ones, such as playback
  speed, go there too, not in the bottom bar.
- The TikTok view and the `video` / `video-draft` exports are TikTok's
  9:16 frame (1080×1920); App Screens and the screenshot export stay
  1320×2868 (App Store 6.9"). How each picture goes into the 9:16 frame
  is its TikTok fit (`src/content/tiktok-fit.ts`, with the rules shared
  with the edit tool in `tiktok-fit-rules.mjs`). `TikTokSafeArea.tsx`
  draws the areas TikTok's own interface covers, and the caption presets
  in `SceneView.tsx` are measured against the same areas.
- Asset keys in a showcase's YAML are file names without extension:
  `asset: shot-mirror` resolves to `assets/shot-mirror.png` in that
  showcase's folder. There is no registry to maintain.
- The persistent brand mark (`meta.watermark`, with a per-scene
  `watermark` override) is resolved per scene in
  `src/content/watermark.ts` and drawn by
  `src/components/showcase/SceneWatermark.tsx` inside each canvas's
  stage — so the player's three view modes, both video exports, and the
  App Store screenshot set all get it from one place. It is a corner
  mark by design: there is no banner position, and the App Store badge
  belongs in a scene's `cta`, not in the watermark.
- A showcase cut from a recording says so once, in `meta.source` (the
  master recording and the playback speed), and each scene names the
  span of it that scene owns in `take`. Everything else — the
  voiceover, the clips, the word timings, every `durationMs` — is
  derived from that one list by `build_media`
  (`server/build-plan.mjs`, `server/build-media.mjs`), so the picture
  and the voice cannot disagree. Nothing in the player knows about
  `take`: the build writes ordinary pins and assets. When a change
  adds something an author would otherwise have to work out by hand,
  it belongs in the cut list, not in a script beside the library.
- Per-showcase styling goes in `showcases/<id>/theme.yaml` — a
  whitelisted set of `colors`, `fonts`, `shape`, and `atmosphere` overrides
  applied by the `/showcase/$showcaseId` layout route. A theme can
  `extends` another showcase's theme, and `fonts.load` lists font
  stylesheet URLs for families the app doesn't already load. Only
  whitelisted keys are accepted — structural CSS variables can't be
  overridden. `meta.theme` in `showcase.yaml` still works as a flat
  quick-override on top. Don't fork component styles per showcase.
- In-app editing (whenever a studio serves the page): pause to edit. A paused player makes
  slide titles click-to-edit and media areas open an asset picker; the
  `/script` page edits titles and caption lines. Edits are structured
  patches — a whitelist of fields (`title`, caption text, `media.asset`, `meta.captionStyle`, `meta.embedCaptions` from the 4:3 captions toggle, and the style panel's theme colors),
  not a generic YAML editor — applied optimistically to the in-memory model
  (`applySceneEditLocal` + `useShowcase` in `showcases.ts`) and written to
  the YAML through the studio's `scene-edit` action (`src/lib/studio.ts`). Undo is Cmd/Ctrl+Z
  (`src/lib/edits.ts`), per showcase and session-scoped. When the library
  is in a git repository the studio also commits each showcase's changes
  after a quiet period (`server/showcase-history.mjs`), so older changes
  can be reviewed and reverted with git. It commits what it wrote itself:
  an outside change never starts a commit, it only rides along in the
  next one. The user turns that on and off with the "Commit changes to
  git" switch under the gear button in the showcase tab bar; it is
  studio-wide, and off by default in the studio Claude Code starts,
  where the session commits with `commit_showcase`. External file
  changes still reload the whole page.
- A setting for a whole library — not one showcase — goes in the
  library's `showcase_settings.yaml` (the library root, beside the
  showcase folders), read through `server/library-config.mjs`. Don't add
  a second library-level file, and don't put settings in `.studio/`: the
  studio's scaffold adds `.studio/` to `.gitignore`, and settings should
  be committed. The studio writes the file, all comments, into every
  library it opens, so it also marks a folder as a library
  (`findLibrary`). When you add a setting, add a commented line for it to
  `SETTINGS_TEMPLATE` (new libraries show it) and describe it in the
  authoring guide (`server/showcase-guide.mjs`). Existing libraries keep
  the file they have, so the guide is how their sessions learn about it.
- The showcase-authoring knowledge a Claude Code session gets inside a
  showcases folder lives in `server/showcase-guide.mjs` (`SHOWCASE_GUIDE`,
  written to `<folder>/.studio/GUIDE.md` on every launch). When a change
  adds or alters something an author has to know — a theme, a media rule
  (e.g. footage video is always muted, so voice comes from a synced
  soundtrack), a caption style, or a whole workflow such as the
  recorded-pitch recipe — update that guide in the same commit. A session
  that had to read a sibling showcase or this source to learn a workflow
  is a sign the guide is missing a section.
- All screenshots are plain image files stored in the showcase's own
  `assets/` folder and resolved locally by key.
- Sharing uses none of the platforms' APIs: the studio gets the video
  and the text ready, and the user posts on the platform's own upload
  page or from their phone. The text a post uses lives in
  showcase.yaml's top-level `publish:` block (a default plus overrides
  for `tiktok`, `instagram`, `youtube`), edited with `publish.set`
  through the usual edit path. Where it can go and the platforms'
  limits are in `src/content/publish-rules.mjs`, shared by the page, the
  edit tool and the share tools. The Share page has to work fully in
  the web view (a browser, Claude Code's preview): anything it can't do
  from a page — opening the upload page, copying, AirDrop, revealing the
  file — goes through the studio server; only dragging the file out of
  the window is desktop-app-only. Sending a video to a phone over the
  local network with a QR code is issue #16.

## Branches

- Name a branch for the kind of change: `fix/<short-name>` for a bug fix,
  `feature/<short-name>` for something new — for example
  `fix/new-showcase-library`.
- The same goes for a worktree's branch. Claude Code's EnterWorktree tool
  names the branch `worktree-<name>`, so make the worktree with git
  instead, then move the session into it (EnterWorktree with `path`):

  ```sh
  git worktree add -b fix/<short-name> .claude/worktrees/<short-name> origin/main
  ```

## Committing

- When building a commit, never modify, move, or delete files on disk to
  control what goes into it — no setting files aside, no temporary edits, no
  triggering regeneration. The working tree must be byte-identical before and
  after preparing a commit.
- To commit a subset of the pending changes, stage selectively instead: whole
  files with `git add <path>`, and individual hunks within a mixed file by
  applying a filtered patch with `git apply --cached`.
