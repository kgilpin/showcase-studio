# Development guide

## Setup and commands

Requires Node.js and npm ([install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)).

```sh
npm i            # install dependencies
npm run dev      # start the dev server (vite dev)
npm run build    # production build
npm run preview  # serve the production build locally
npm run lint     # eslint
npm run format   # prettier --write .
npm test         # vitest (slide timing model)

npm run export:screens             # capture App Store screenshots for every
npm run export:screens -- <id>     # showcase (or one) to exports/<id>/
                                   # (needs the dev server running; first time:
                                   #  npx playwright install chromium)
                                   # App Screens presentation: slide titles
                                   # shown, captions off

npm run export:video               # render every showcase (or one) as an MP4
npm run export:video -- <id>       # to exports/<id>/video.mp4 — frame-by-frame
                                   # at 1320×2868, 30 fps (slow but exact)
                                   # Video presentation: captions overlaid on
                                   # the media, slide titles hidden
npm run export:video -- --realtime # quick 440×956 draft (video-draft.mp4)
npm run export:video -- --prompter # record the teleprompter (/script page)
                                   # instead: 1280×720 real-time draft to
                                   # exports/<id>/prompter-draft.mp4
                                   # (needs the dev server running)

npm run export:script              # print every showcase's narration script
npm run export:script -- <id>      # (or one) as plain text to stdout — the
                                   # same spoken lines as the /script page.
                                   # Reads the YAML directly; no dev server.

npm run electron:dev               # the desktop shell: starts a dev server in
                                   # data mode and opens the app in Electron,
                                   # reading showcases from ~/Showcases
                                   # (SHOWCASES_DIR overrides; seeded from
                                   # src/showcases/ on first run; live-reloads
                                   # when the folder changes)
```

## Where things live

| Path                         | Purpose                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/showcases/<id>/`        | One folder per showcase: `showcase.yaml` (the script), optional `theme.yaml` (styling), and `assets/` (its screenshots). Folders are discovered automatically. |
| `src/content/showcases.ts`   | Generic loader: parses each showcase's YAML, resolves asset keys (file name without extension) to URLs, and resolves each showcase's theme (whitelist, `extends`, font loads). Documents the scene/theme model. |
| `src/content/source.ts`      | Where the showcase data comes from: folders bundled at build time (default, SSR-safe), or the same files fetched over HTTP when `VITE_SHOWCASES_URL` is set (the dev server serves `/showcases` in that shape — the seam a desktop shell points at a user folder). |
| `src/components/showcase/`   | The player: `ShowcasePlayer`, `SceneView` (slide layouts), `SceneMedia` (motion), `ProgressRail`, `Soundtrack`.                                          |
| `src/components/script/`     | The script page: script listing and teleprompter.                                                                                                         |
| `src/routes/`                | TanStack Router file routes: `/` (home), `/showcase/$showcaseId` (+ `/script`, `/export`, `/export/$sceneId`, `/record`).                                 |
| `scripts/export-screens.mjs` | Playwright script that screenshots each export page at 1320×2868 (App Store 6.9"). Scenes with `export: false` are skipped.                               |
| `scripts/export-video.mjs`   | Playwright script that renders each showcase's `/record` page to an MP4 — frame-by-frame via `window.__record.seek()` by default, or a real-time screen recording with `--realtime`. |
| `scripts/export-script.mjs`  | Prints a showcase's narration script as plain text (the same spoken lines as the `/script` page), straight from the YAML — no server or browser needed.  |
| `src/assets/`                | Shared UI assets only (App Store badge). Showcase screenshots live in each showcase's own `assets/` folder.                                               |
| `electron/`                  | The desktop shell: `main.mjs` (serves the user's showcases folder in the data shape, opens the window, watches for changes), `exporter.mjs` (in-app screenshot/video exports via offscreen capture + bundled ffmpeg — no Playwright; Export buttons on the `/export` page write to `~/Downloads/showcase-exports/<id>`; `ELECTRON_EXPORT=screens:<id>` or `video:<id>` runs headless), `agent.mjs` + `agent-tools.mjs` (the BYOK Claude agent: key stored via safeStorage, streaming tool loop on `claude-opus-5`, tools confined to the showcases folder; panel UI in `src/components/studio/StudioAgent.tsx`), `preload.cjs` (the `window.showcaseStudio` bridge, typed in `src/lib/studio.ts`), and `dev.mjs` (starts the dev server in data mode, then Electron). `scripts/showcase-data.mjs` holds the folder-serving shape both the shell and the vite middleware use. |

## Conventions

- Slide designs are a fixed set of themes (`title`, `feature`, `statement`)
  defined in `SceneView.tsx`. Do not style individual scenes ad hoc; add or
  change a theme instead, and document it in `showcases.ts`.
- Asset keys in a showcase's YAML are file names without extension:
  `asset: shot-mirror` resolves to `assets/shot-mirror.png` in that
  showcase's folder. There is no registry to maintain.
- Per-showcase styling goes in `src/showcases/<id>/theme.yaml` — a
  whitelisted set of `colors`, `fonts`, `shape`, and `atmosphere` overrides
  applied by the `/showcase/$showcaseId` layout route. A theme can
  `extends` another showcase's theme, and `fonts.load` lists font
  stylesheet URLs for families the app doesn't already load. Only
  whitelisted keys are accepted — structural CSS variables can't be
  overridden. `meta.theme` in `showcase.yaml` still works as a flat
  quick-override on top. Don't fork component styles per showcase.
- All screenshots are plain image files, imported/resolved locally. Avoid
  Lovable `.asset.json` pointer files — they resolve to `/__l5e/assets-v1/...`
  URLs that only exist inside Lovable's hosted sandbox and 404 in local
  development. If Lovable adds one, download the real image and store it in
  the showcase's `assets/` folder instead.

## Committing

- When building a commit, never modify, move, or delete files on disk to
  control what goes into it — no setting files aside, no temporary edits, no
  triggering regeneration. The working tree must be byte-identical before and
  after preparing a commit.
- To commit a subset of the pending changes, stage selectively instead: whole
  files with `git add <path>`, and individual hunks within a mixed file by
  applying a filtered patch with `git apply --cached`.

## Lovable sync

This repo is connected to Lovable (see `AGENTS.md`). Do not force-push,
rebase, amend, or squash commits that are already pushed — it breaks the
project history on Lovable's side. Keep the connected branch in a working
state.
