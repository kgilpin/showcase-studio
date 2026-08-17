/* =============================================================
 * SHOWCASE MODEL
 *
 * Every showcase lives in its own folder under `src/showcases/<id>/`:
 *
 *   src/showcases/<id>/showcase.yaml   the script (scenes, copy, timings)
 *   src/showcases/<id>/theme.yaml      optional styling (see SHOWCASE THEME)
 *   src/showcases/<id>/assets/         its screenshots and app mark
 *
 * Folders are discovered automatically at build time — adding a new
 * showcase requires no code changes. Asset keys in the YAML are simply
 * file names without their extension: `asset: shot-mirror` resolves to
 * `assets/shot-mirror.png`.
 * ============================================================= */

import { parse } from "yaml";
import type { ComponentType } from "react";
import { resolveSceneTiming } from "./timing.mjs";
import { activeSource, type ShowcaseAsset, type ShowcaseSource } from "./source";
import { remoteGraphic } from "./graphics-runtime";

/* Caption/title timing is shared with the export scripts — the model and
 * implementation live in timing.mjs. */
export { activeCaption, captionTimeline, readingTime } from "./timing.mjs";

/* -------------------------------------------------------------
 * THEMES — the fixed set of screen designs.
 *
 * "title"     Centered app mark above a large display-serif title.
 *             No body copy. Used for the intro screen.
 * "feature"   Title + description on one side, phone screenshot on the
 *             other.
 * "statement" Centered display-serif line over a dimmed full-bleed
 *             backdrop, with optional one-line body and CTA. Used for outros.
 * "console"   Title above a wide landscape media panel with captions
 *             overlaid on it. For desktop/web app screenshots that don't
 *             fit a phone frame.
 *
 * Adding a new theme is a design change: define it in SceneView.tsx and
 * document it here first. Do not style scenes ad hoc.
 * ------------------------------------------------------------- */
export type SceneTheme = "title" | "feature" | "statement" | "console";

/** Which part of a cropped screenshot stays visible. "top" clips the bottom,
 *  "bottom" clips the top, "center" clips both evenly (default). */
export type MediaAlign = "top" | "center" | "bottom";

/** How the screenshot fills its area. "cover" (default) crops to fill;
 *  "contain" keeps the whole screenshot visible with no cropping. */
export type MediaFit = "cover" | "contain";

export type SceneMotion = "zoom-in" | "zoom-out" | "pan-up" | "pan-left" | "still";

export type SceneMedia =
  | {
      kind: "image" | "video";
      src: string;
      /** Asset key: the file name (no extension) in the showcase's assets folder. */
      asset?: string | undefined;
      file?: string | undefined;
      /** Describe the screenshot for accessibility. */
      alt: string;
      motion?: SceneMotion;
      /**
       * "phone" = framed in a device (feature theme).
       * "full"  = edge-to-edge backdrop (statement theme) or landscape
       *           panel (console theme).
       * "mark"  = app-icon tile (title / statement theme).
       */
      frame?: "phone" | "full" | "mark";
      /** Which edge of the screenshot to keep when it's cropped to fit. */
      align?: MediaAlign;
      /** Crop to fill ("cover", default) or show the whole image ("contain"). */
      fit?: MediaFit;
      /** Optional second screenshot that cross-fades in midway through the scene. */
      fadeTo?:
        | {
            src: string;
            alt: string;
            asset?: string | undefined;
            file?: string | undefined;
            align?: MediaAlign;
          }
        | undefined;
    }
  | {
      /** A TSX-authored diagram from the showcase's graphics/ folder.
       *  Graphics animate with CSS only (no JS timers) so the player's
       *  pause, the screenshot export's freeze, and the video recorder's
       *  frame seeking all work; their resting state must be the fully
       *  revealed diagram. Style with theme CSS variables. */
      kind: "graphic";
      /** Graphic key: the file name (no extension) in graphics/. */
      graphic: string;
      component: ComponentType;
      file?: string | undefined;
      /** Describe the diagram for accessibility. */
      alt: string;
      /** Defaults to "still" — diagrams usually animate themselves. */
      motion?: SceneMotion;
      frame?: "phone" | "full" | "mark";
    }
  | { kind: "none" };

/** Where an overlay caption sits on the slide.
 *  "bottom" (default) pinned near the bottom edge,
 *  "center" vertically centered, "lower" 60% of the way down,
 *  "top" near the top of the screenshot. */
export type CaptionPosition = "top" | "center" | "lower" | "bottom";

/** One overlay line. `durationMs` is optional — see the TIMING model in
 *  timing.mjs: all timing derives from the copy unless pinned explicitly. */
export type SceneCaption = { text: string; durationMs?: number; position?: CaptionPosition };

/* Presentation is not configurable per showcase. There are two, matching
 * the two exports: "App Screens" (titles on the slide, captions beside it
 * — the screenshot export) and "video" (captions over the media with no
 * titles competing — the video export). The player starts on App Screens
 * and the viewer can toggle between them. Caption text always uses the
 * large size. */

export type Scene = {
  id: string;
  /** Required. One of the documented THEMES above. */
  theme: SceneTheme;
  eyebrow?: string;
  title: string;
  /** Overlay lines shown in order across the slide. */
  captions: SceneCaption[];
  /** Convenience alias for the first caption. */
  body?: string | undefined;
  media: SceneMedia;
  /** Resolved slide length — explicit in the YAML, or derived from the copy. */
  durationMs: number;
  /** Resolved spoken-title window at the start of the slide (title-theme
   *  slides; 0 elsewhere). Captions start after it. */
  titleMs: number;
  /** Set false to leave this scene out of the exported screenshot set. */
  export?: boolean;
  /** Smaller supporting paragraph shown under `body` (statement theme). */
  support?: string;
  /** Small, low-emphasis line shown under the call to action. */
  ctaNote?: string;
  /** Optional call-to-action link shown below the body on statement scenes.
   *  kind "app-store" (default) renders the App Store badge; "link" renders
   *  a plain labeled button for products with no store listing. */
  cta?: {
    label: string;
    url: string;
    kind?: "app-store" | "link";
  };
};

export type Showcase = {
  /** Folder name under src/showcases/ — also the URL segment. */
  id: string;
  title: string;
  description: string;
  /** Loop back to the first scene when the last one finishes. */
  loop: boolean;
  soundtrack: { src: string; volume: number };
  /** Asset key for the home-page card image (defaults to the app mark). */
  cover?: string | undefined;
  /** Resolved styling: CSS-variable overrides (names without the leading
   *  `--`) plus font stylesheet URLs to load. Combined, in order: the
   *  extended showcase's theme, this showcase's theme.yaml, and the
   *  meta.theme quick overrides in showcase.yaml. Anything not set falls
   *  back to the default design in styles.css. */
  theme: ResolvedTheme;
  scenes: Scene[];
  /** Scenes included in the App Store screenshot export (`export: false` opts out). */
  exportScenes: Scene[];
};

type RawMedia =
  | { kind: "none" }
  | {
      kind: "image" | "video";
      asset: string;
      alt: string;
      motion?: SceneMotion;
      frame?: "phone" | "full" | "mark";
      align?: MediaAlign;
      fit?: MediaFit;
      fadeTo?: { asset: string; alt: string; align?: MediaAlign };
    }
  | {
      kind: "graphic";
      graphic: string;
      alt: string;
      motion?: SceneMotion;
      frame?: "phone" | "full" | "mark";
    };

type RawScene = Omit<Scene, "media" | "captions" | "body" | "durationMs" | "titleMs"> & {
  media?: RawMedia;
  captions?: SceneCaption[];
  durationMs?: number;
  titleDurationMs?: number;
};

type RawDoc = {
  meta: {
    title: string;
    description: string;
    loop: boolean;
    soundtrack: { src: string; volume: number };
    cover?: string;
    /** Reading speed in words per second for derived timing (default 3). */
    pace?: number;
    theme?: Record<string, string>;
  };
  scenes: RawScene[];
};

/* -------------------------------------------------------------
 * SHOWCASE THEME — src/showcases/<id>/theme.yaml
 *
 * Per-showcase styling. Only the keys below are themeable; the loader
 * rejects anything else at build time, so a theme cannot override the
 * structural variables the app needs (the Tailwind `@theme inline` wiring,
 * radius derivations, library internals).
 *
 *   extends: <showcase-id>   start from another showcase's resolved theme;
 *                            keys set here override the inherited values
 *   colors: { primary: ... }
 *   fonts: { display: ..., body: ..., load: [<stylesheet url>, ...] }
 *   shape: { radius: ... }
 *   atmosphere: { gradient-stage: ..., gradient-accent: ..., shadow-device: ... }
 *
 * `fonts.load` is for font families the app does not already load: list
 * stylesheet URLs (e.g. Google Fonts) and they are added to <head> on that
 * showcase's pages. `meta.theme` in showcase.yaml still works as a flat
 * map of the same CSS-variable names, applied on top of theme.yaml.
 * ------------------------------------------------------------- */

/** Themeable keys, by group, mapped to the CSS variable each one sets. */
const THEME_GROUPS: Record<string, Record<string, string>> = {
  colors: Object.fromEntries(
    [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "border",
      "support",
    ].map((name) => [name, name]),
  ),
  fonts: { display: "font-display", body: "font-body" },
  shape: { radius: "radius" },
  atmosphere: {
    "gradient-stage": "gradient-stage",
    "gradient-accent": "gradient-accent",
    "shadow-device": "shadow-device",
  },
};

/** Every CSS-variable name a theme may set (also the valid `meta.theme` keys). */
const THEMEABLE_VARS = new Set(Object.values(THEME_GROUPS).flatMap((keys) => Object.values(keys)));

export type ResolvedTheme = {
  /** CSS-variable overrides, names without the leading `--`. */
  vars: Record<string, string>;
  /** Font stylesheet URLs to load on this showcase's pages (own + inherited). */
  fontLoads: string[];
};

type RawTheme = {
  extends?: string;
  colors?: Record<string, unknown>;
  fonts?: Record<string, unknown>;
  shape?: Record<string, unknown>;
  atmosphere?: Record<string, unknown>;
};

function validateThemeDoc(showcaseId: string, doc: RawTheme): void {
  const file = `src/showcases/${showcaseId}/theme.yaml`;
  const groups = Object.keys(THEME_GROUPS);
  for (const key of Object.keys(doc)) {
    if (key !== "extends" && !groups.includes(key)) {
      throw new Error(
        `Unknown section "${key}" in ${file} — expected: extends, ${groups.join(", ")}`,
      );
    }
  }
  if (doc.extends != null && typeof doc.extends !== "string") {
    throw new Error(
      `"extends" in ${file} must be a showcase id (folder name under src/showcases/)`,
    );
  }
  for (const [group, keys] of Object.entries(THEME_GROUPS)) {
    const section = doc[group as keyof RawTheme];
    if (section == null) continue;
    if (typeof section !== "object" || Array.isArray(section)) {
      throw new Error(`"${group}" in ${file} must be a map of ${Object.keys(keys).join(", ")}`);
    }
    for (const [key, value] of Object.entries(section)) {
      if (group === "fonts" && key === "load") {
        if (!Array.isArray(value) || value.some((url) => typeof url !== "string")) {
          throw new Error(`"fonts.load" in ${file} must be a list of stylesheet URLs`);
        }
        continue;
      }
      if (!(key in keys)) {
        throw new Error(
          `Unknown ${group} key "${key}" in ${file} — themeable ${group} keys: ${Object.keys(keys).join(", ")}`,
        );
      }
      if (typeof value !== "string" && typeof value !== "number") {
        throw new Error(`"${group}.${key}" in ${file} must be a CSS value (got ${typeof value})`);
      }
    }
  }
}

function validateMetaTheme(showcaseId: string, theme: Record<string, string>): void {
  for (const name of Object.keys(theme)) {
    if (!THEMEABLE_VARS.has(name)) {
      throw new Error(
        `meta.theme in showcase "${showcaseId}" sets "--${name}", which is not themeable. ` +
          `Themeable variables: ${[...THEMEABLE_VARS].sort().join(", ")}`,
      );
    }
  }
}

/* -------------------------------------------------------------
 * Discovery — showcase data comes from the active source (see
 * source.ts): bundled folders by default, or plain files over HTTP
 * when VITE_SHOWCASES_URL is set.
 * ------------------------------------------------------------- */

/* TSX-authored diagrams, one component per file in graphics/. Same
 * discovery and naming rules as assets: the key is the file name.
 * Graphics are code, not data — they are always bundled, in either
 * source mode. */
const graphicModules = import.meta.glob("../showcases/*/graphics/*.tsx", {
  import: "default",
  eager: true,
}) as Record<string, ComponentType>;

type GraphicEntry = { component: ComponentType; file: string };

const graphicsByShowcase = new Map<string, Map<string, GraphicEntry>>();
for (const [path, component] of Object.entries(graphicModules)) {
  const parts = path.split("/");
  const showcaseId = parts.at(-3)!;
  const filename = parts.at(-1)!;
  const key = filename.replace(/\.tsx$/, "");
  let entries = graphicsByShowcase.get(showcaseId);
  if (!entries) graphicsByShowcase.set(showcaseId, (entries = new Map()));
  entries.set(key, { component, file: `src/showcases/${showcaseId}/graphics/${filename}` });
}

/* Folder-authored graphics (data mode): graphic key → compiled-module URL,
 * loaded lazily through the graphics runtime. The user's folder is the
 * source of truth, so a folder graphic wins over a bundled one with the
 * same showcase id and key; bundled graphics are the fallback. */
const dataGraphicsByShowcase = new Map<string, Map<string, string>>();

function resolveGraphic(showcaseId: string, key: string): GraphicEntry {
  const url = dataGraphicsByShowcase.get(showcaseId)?.get(key);
  if (url) {
    const file = `${showcaseId}/graphics/${key}.tsx`;
    return { component: remoteGraphic(url, file), file };
  }
  const bundled = graphicsByShowcase.get(showcaseId)?.get(key);
  if (bundled) return bundled;
  throw new Error(
    `Unknown graphic "${key}" in showcase "${showcaseId}" — ` +
      `expected a component at ${showcaseId}/graphics/${key}.tsx (in the showcases folder ` +
      `or bundled under src/showcases/)`,
  );
}

const assetsByShowcase = new Map<string, Map<string, ShowcaseAsset>>();

function resolveAsset(showcaseId: string, key: string): ShowcaseAsset {
  const entry = assetsByShowcase.get(showcaseId)?.get(key);
  if (!entry) {
    throw new Error(
      `Unknown asset "${key}" in showcase "${showcaseId}" — ` +
        `expected a file named ${key}.* in the showcase's assets/ folder`,
    );
  }
  return entry;
}

function resolveMedia(showcaseId: string, media?: RawMedia): SceneMedia {
  if (!media || media.kind === "none") return { kind: "none" };
  if (media.kind === "graphic") {
    const graphic = resolveGraphic(showcaseId, media.graphic);
    return {
      kind: "graphic",
      graphic: media.graphic,
      component: graphic.component,
      file: graphic.file,
      alt: media.alt,
      ...(media.motion ? { motion: media.motion } : {}),
      ...(media.frame ? { frame: media.frame } : {}),
    };
  }
  const asset = resolveAsset(showcaseId, media.asset);
  return {
    kind: media.kind,
    src: asset.url,
    asset: media.asset,
    file: asset.file,
    alt: media.alt,
    ...(media.motion ? { motion: media.motion } : {}),
    ...(media.frame ? { frame: media.frame } : {}),
    ...(media.align ? { align: media.align } : {}),
    ...(media.fit ? { fit: media.fit } : {}),
    fadeTo: media.fadeTo
      ? {
          src: resolveAsset(showcaseId, media.fadeTo.asset).url,
          alt: media.fadeTo.alt,
          asset: media.fadeTo.asset,
          file: resolveAsset(showcaseId, media.fadeTo.asset).file,
          ...(media.fadeTo.align ? { align: media.fadeTo.align } : {}),
        }
      : undefined,
  };
}

/* -------------------------------------------------------------
 * Theme resolution — parent theme (extends) first, then this showcase's
 * theme.yaml, then its meta.theme quick overrides. CSS variables cascade,
 * so anything left unset falls through to the defaults in styles.css.
 * ------------------------------------------------------------- */

const rawDocs = new Map<string, RawDoc>();
const themeDocs = new Map<string, RawTheme>();
const resolvedThemes = new Map<string, ResolvedTheme>();

function resolveTheme(showcaseId: string, stack: string[] = []): ResolvedTheme {
  const cached = resolvedThemes.get(showcaseId);
  if (cached) return cached;
  if (stack.includes(showcaseId)) {
    throw new Error(`Theme "extends" cycle: ${[...stack, showcaseId].join(" -> ")}`);
  }

  const doc = themeDocs.get(showcaseId) ?? {};
  let vars: Record<string, string> = {};
  const fontLoads: string[] = [];

  if (doc.extends) {
    if (!rawDocs.has(doc.extends)) {
      throw new Error(
        `Showcase "${showcaseId}" extends unknown showcase "${doc.extends}" — ` +
          `expected a folder under src/showcases/ with a showcase.yaml`,
      );
    }
    const parent = resolveTheme(doc.extends, [...stack, showcaseId]);
    vars = { ...parent.vars };
    fontLoads.push(...parent.fontLoads);
  }

  for (const [group, keys] of Object.entries(THEME_GROUPS)) {
    const section = doc[group as keyof RawTheme];
    if (section == null || typeof section !== "object") continue;
    for (const [key, value] of Object.entries(section)) {
      if (group === "fonts" && key === "load") continue;
      vars[keys[key]!] = String(value);
    }
  }
  const load = doc.fonts?.["load"];
  if (Array.isArray(load)) fontLoads.push(...(load as string[]));

  const metaTheme = rawDocs.get(showcaseId)?.meta.theme;
  if (metaTheme) {
    validateMetaTheme(showcaseId, metaTheme);
    vars = { ...vars, ...metaTheme };
  }

  const resolved: ResolvedTheme = { vars, fontLoads: [...new Set(fontLoads)] };
  resolvedThemes.set(showcaseId, resolved);
  return resolved;
}

function buildShowcase(showcaseId: string, doc: RawDoc): Showcase {
  const scenes: Scene[] = doc.scenes.map((raw) => {
    const { titleDurationMs: _, ...scene } = raw;
    const timing = resolveSceneTiming(raw, doc.meta.pace);
    return {
      ...scene,
      ...timing,
      body: timing.captions[0]?.text,
      media: resolveMedia(showcaseId, scene.media),
    };
  });
  return {
    id: showcaseId,
    ...doc.meta,
    theme: resolveTheme(showcaseId),
    scenes,
    exportScenes: scenes.filter((scene) => scene.export !== false),
  };
}

async function loadFromSource(source: ShowcaseSource): Promise<Showcase[]> {
  const data = await source.load();
  rawDocs.clear();
  themeDocs.clear();
  resolvedThemes.clear();
  assetsByShowcase.clear();
  dataGraphicsByShowcase.clear();
  /* One broken showcase must not take down the library — with live
   * reload, the app would otherwise blank out on every YAML typo. A
   * showcase that fails to parse or build is set aside with its error;
   * the home page shows it as a fix-me card. */
  const errors: ShowcaseError[] = [];
  const fail = (id: string, error: unknown) => {
    errors.push({ id, message: error instanceof Error ? error.message : String(error) });
    console.error(`Showcase "${id}" failed to load:`, error);
  };
  for (const entry of data) {
    assetsByShowcase.set(entry.id, entry.assets);
    dataGraphicsByShowcase.set(entry.id, entry.graphics);
    try {
      rawDocs.set(entry.id, parse(entry.yaml) as RawDoc);
      if (entry.themeYaml != null) {
        const doc = (parse(entry.themeYaml) ?? {}) as RawTheme;
        validateThemeDoc(entry.id, doc);
        themeDocs.set(entry.id, doc);
      }
    } catch (error) {
      rawDocs.delete(entry.id);
      fail(entry.id, error);
    }
  }
  const built: Showcase[] = [];
  for (const [showcaseId, doc] of rawDocs) {
    try {
      built.push(buildShowcase(showcaseId, doc));
    } catch (error) {
      fail(showcaseId, error);
    }
  }
  showcases = built.sort((a, b) => a.title.localeCompare(b.title));
  showcaseErrors = errors;
  return showcases;
}

/* Populated once showcasesReady resolves; the root route's loader awaits
 * it, so components can keep reading synchronously. (With the bundled
 * source the promise resolves immediately from build-time data.) */
export let showcases: Showcase[] = [];

/** Showcases that failed to parse or build this load, with their errors —
 *  shown as fix-me cards on the home page. */
export type ShowcaseError = { id: string; message: string };
export let showcaseErrors: ShowcaseError[] = [];

export const showcasesReady: Promise<Showcase[]> = loadFromSource(activeSource());

export function getShowcase(id: string): Showcase | undefined {
  return showcases.find((showcase) => showcase.id === id);
}

/** The home-page card image: `meta.cover` if set, else the first
 *  mark-framed asset, else the first image in the showcase. */
export function coverUrl(showcase: Showcase): string | undefined {
  if (showcase.cover) return resolveAsset(showcase.id, showcase.cover).url;
  const mark = showcase.scenes.find((s) => s.media.kind === "image" && s.media.frame === "mark");
  if (mark && mark.media.kind === "image") return mark.media.src;
  const image = showcase.scenes.find((s) => s.media.kind === "image");
  return image && image.media.kind === "image" ? image.media.src : undefined;
}

/** Inline-style CSS variables for a showcase's resolved theme. */
export function themeVars(showcase: Showcase): Record<string, string> {
  return Object.fromEntries(
    Object.entries(showcase.theme.vars).map(([name, value]) => [`--${name}`, value]),
  );
}

/** <head> link descriptors for the font stylesheets a showcase's theme loads. */
export function fontLinks(showcase: Showcase): { rel: string; href: string }[] {
  return showcase.theme.fontLoads.map((href) => ({ rel: "stylesheet", href }));
}
