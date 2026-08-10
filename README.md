# App Showcase

A web app that plays video-style, auto-advancing tours of apps. The home
page lists the available showcases; the first one is NOVA, a real-time
game of galactic conquest.

A showcase looks and feels like a product video, but it is built entirely
from web pages: each "slide" is a React scene with a title, captions,
a screenshot, and gentle motion. Because it is a web page rather than a
rendered video, the content is easy to edit, translate, and restyle — and
every scene can also be exported as an App Store screenshot.

## How it works

Each showcase is a folder under `src/showcases/`:

```
src/showcases/
  nova/
    showcase.yaml   the script: scenes, copy, timings
    assets/         its screenshots and app mark
```

Folders are discovered automatically at build time — the home page lists
every showcase it finds. `showcase.yaml` is the script. Each entry under
`scenes:` is one slide and declares:

- **theme** — one of three fixed slide designs: `title` (big centered
  headline), `feature` (headline plus a phone screenshot), or `statement`
  (centered line over a backdrop).
- **captions** — overlay lines shown in sequence, each with an optional
  duration.
- **media** — which screenshot to show (`asset: shot-mirror` means the file
  `assets/shot-mirror.png` in the showcase's folder), how it moves
  (`zoom-in`, `pan-up`, …), and how it is framed (`phone`, `full`, `mark`).
- **durationMs** — how long the slide stays on screen.

## Pages

| Route                   | What it shows                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `/`                     | Home: a card for every showcase.                                                                                            |
| `/showcase/<id>`        | The player: auto-advancing slides, progress rail, soundtrack.                                                               |
| `/showcase/<id>/script` | The full script, slide by slide, with timings and screenshot thumbnails — plus a teleprompter mode for recording narration. |
| `/showcase/<id>/export` | A gallery of the App Store screenshot frames. Click a tile to see the full-size frame.                                      |

Player controls: click anywhere or press **space** to pause, **←/→** to move
between scenes. A toggle switches captions between appearing beside the slide
or overlaid on it.

## Adding a new showcase

1. Create `src/showcases/<id>/` — the folder name becomes the URL
   (`/showcase/<id>`).
2. Add `showcase.yaml` (copy NOVA's as a starting point) and an
   `assets/` folder with the screenshots it references.
3. That's it — no code changes. The home page picks it up automatically.

To restyle a showcase, add a `theme:` map to its `meta:` block. Entries are
CSS-variable overrides (for example `gradient-stage`, `gradient-accent`,
`primary`); anything not set falls back to the default design.

## Exporting App Store screenshots

Every scene can be exported as an iPhone-sized still image (1320×2868, the
App Store 6.9" screenshot size), with the scene title, caption, and
screenshot composed exactly as in the showcase — but with all motion frozen.

```sh
npm run dev                        # in one terminal
npm run export:screens             # every showcase → exports/<id>/*.png
npm run export:screens -- nova     # or just the named showcase
```

Scenes that don't work as store screenshots (for example text-only opening
slides) opt out with `export: false` in `showcase.yaml`. Preview the full
set any time at `/showcase/<id>/export`.

## Built with

TanStack Start, React, TypeScript, and Tailwind CSS. The project was built
with [Lovable](https://lovable.dev) and stays in sync with the Lovable editor
through GitHub.

Local development instructions are in [CLAUDE.md](CLAUDE.md).
