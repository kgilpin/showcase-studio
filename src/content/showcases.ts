/* =============================================================
 * SHOWCASE MODEL
 *
 * Every showcase lives in its own folder under `showcases/<id>/`:
 *
 *   showcases/<id>/showcase.yaml   the script (scenes, copy, timings)
 *   showcases/<id>/theme.yaml      optional styling (see SHOWCASE THEME)
 *   showcases/<id>/assets/         its screenshots and app mark
 *
 * Folders are discovered automatically at build time — adding a new
 * showcase requires no code changes. Asset keys in the YAML are simply
 * file names without their extension: `asset: shot-mirror` resolves to
 * `assets/shot-mirror.png`.
 * ============================================================= */

import { parse } from "yaml";
import { useSyncExternalStore, type ComponentType } from "react";
import { alignCaptionWords, resolveSceneTiming, type WordWindow } from "./timing.mjs";
import { activeSource, type ShowcaseAsset, type ShowcaseSource } from "./source";
import { remoteGraphic } from "./graphics-runtime";
import { looksCutOff } from "./theme-value";
import { ASSET_KINDS, assetKind, mediaKindWarning, type AssetKind } from "./asset-kind";
import {
  CAPTION_POSITION_HELP,
  isCaptionPosition,
  type CaptionPreset,
} from "./caption-position-rules.mjs";
import { readWatermark, resolveWatermark, type Watermark, type WatermarkSpec } from "./watermark";
import { readTikTokFit, resolveTikTokFit, type TikTokFit, type TikTokFitSpec } from "./tiktok-fit";
import type { SceneEdit } from "@/lib/studio";

/* Caption/title timing is shared with the export scripts — the model and
 * implementation live in timing.mjs. */
export { activeCaption, captionTimeline, readingTime, wordTimeline } from "./timing.mjs";
export type { WordWindow } from "./timing.mjs";

/* -------------------------------------------------------------
 * THEMES — the fixed set of slide layouts. A theme names where text and
 * media go, nothing more: narration always lives in captions, and titles
 * are on-screen text only.
 *
 * "statement" Centered display text — claims, intros, outros. Optional
 *             app-mark media above the title, optional CTA below.
 * "feature"   Title header over a phone-framed screenshot.
 * "console"   Title above a wide landscape media panel. For desktop/web
 *             screenshots and TSX diagrams that don't fit a phone frame.
 * "footage"   The media IS the slide — edge-to-edge, no title header.
 *             For on-camera segments; captions act as subtitles (overlay
 *             presentation only) and the scene defaults out of the
 *             screenshot export.
 *
 * "title" is a legacy alias for "statement" (the linter flags it). An
 * unrecognized theme renders anyway — the layout is inferred from the
 * scene's media — with a linter warning in the diagnostics tray.
 *
 * Adding a new theme is a design change: define it in SceneView.tsx and
 * document it here first. Do not style scenes ad hoc.
 * ------------------------------------------------------------- */
export type SceneTheme = "statement" | "feature" | "console" | "footage";

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
      /** How the picture goes into TikTok's 9:16 frame — resolved from
       *  `media.tiktok`, `meta.tiktok`, then fit/align (tiktok-fit.ts). */
      tiktok?: TikTokFit;
      /** The scene's own media.tiktok as authored (checked), when it has
       *  one — the stage controls show it can be reset. */
      tiktokOwn?: TikTokFitSpec | undefined;
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

/** Where an overlay caption sits on the slide: a preset — "top",
 *  "center", "lower", or "bottom" (the default) — or an exact height
 *  ("14%" puts the caption's top edge 14% down). Each format places a
 *  preset at its own height: in the portrait TikTok video, top and
 *  bottom stay clear of the interface TikTok lays over the video. The
 *  table and the allowed range are in caption-position-rules.mjs,
 *  shared with the studio's edit tool. */
export type CaptionPosition = CaptionPreset | `${number}%`;

/** One overlay line. `durationMs` is optional — see the TIMING model in
 *  timing.mjs: all timing derives from the copy unless pinned explicitly.
 *  `words` (exact per-word reveal windows) is attached at build time when
 *  the showcase has a voiceover word-timestamp sidecar — never authored. */
export type SceneCaption = {
  text: string;
  durationMs?: number;
  position?: CaptionPosition;
  words?: WordWindow[];
};

/** How an overlay caption paints its line (TikTok view, video exports).
 *  "chip" (default) fades the whole line in; "karaoke" shows the line
 *  dimmed and brightens word by word; "reveal" makes each word appear on
 *  its cue (layout reserved up front, so nothing reflows). Both worded
 *  styles pace with the reading-time model (wordTimeline in timing.mjs),
 *  or with exact voiceover word timestamps when the showcase has them.
 *  Set per scene, or for the whole showcase with `meta.captionStyle`. */
export type CaptionStyle = "chip" | "karaoke" | "reveal";

/* The player previews the export destinations as three view modes: "App
 * Screens" (titles on the slide, captions beside — the screenshot export),
 * "TikTok" (portrait, captions overlaid, titles hidden — the video export),
 * and "4:3" (the embed canvas — the video-43 export). Two per-showcase
 * presentation choices carry across all three: `meta.embedCaptions`,
 * whether the 4:3 canvas overlays captions (unset follows the voiceover —
 * embed-captions.ts), and `meta.watermark`, the brand mark drawn in a
 * corner of every slide (watermark.ts). Caption text always uses the
 * large size. */

export type Scene = {
  id: string;
  /** Normalized to one of the documented THEMES above (legacy and unknown
   *  names are mapped, with a linter warning). */
  theme: SceneTheme;
  eyebrow?: string;
  /** Authoring note — context an author or agent keeps with the scene
   *  (what a take is, what's still pending). Never rendered in the
   *  player or any export; shown on the script page. Notes live here,
   *  not in YAML comments: comments don't follow a scene through the
   *  edit tool's move/delete, this field does. */
  note?: string | undefined;
  /** On-screen display text only — never spoken, never timed. Omit it on
   *  scenes that don't display one (footage). */
  title?: string | undefined;
  /** The narration: lines read verbatim in order, each with derived or
   *  explicit timing. */
  captions: SceneCaption[];
  /** Convenience alias for the first caption. */
  body?: string | undefined;
  media: SceneMedia;
  /** Resolved slide length — explicit in the YAML, or derived from the copy. */
  durationMs: number;
  /** Set false to leave this scene out of the exported screenshot set
   *  (footage scenes default out; `export: true` opts one back in). */
  export?: boolean;
  /** Linter warnings for this scene — shown in the diagnostics tray and
   *  beside the slide in the player. */
  warnings?: string[];
  /** Entrance animation when the slide appears. Off by default so scenes
   *  (especially video footage) cut cleanly; `rise` opts in to the
   *  rise/drift-in entrance. */
  transition?: "rise" | "none";
  /** Overlay caption painting (see CaptionStyle); resolved from the
   *  scene, else meta.captionStyle, else "chip". */
  captionStyle?: CaptionStyle | undefined;
  /** The persistent brand mark for this slide, resolved from
   *  meta.watermark and the scene's own `watermark` override, with the
   *  mark image already pointed at its served URL (see watermark.ts). */
  watermark?: Watermark | undefined;
  /** Smaller supporting paragraph shown under `body` (statement theme). */
  support?: string;
  /** Small, low-emphasis line shown under the call to action. */
  ctaNote?: string;
  /** Optional call-to-action link shown below the body on statement scenes.
   *  kind "app-store" (default) renders the App Store badge; "github" the
   *  "View on GitHub" badge; "link" a plain labeled button for any other
   *  destination. */
  cta?: {
    label: string;
    url: string;
    kind?: "app-store" | "github" | "link";
  };
};

export type Showcase = {
  /** Folder name under showcases/ — also the URL segment. */
  id: string;
  title: string;
  description: string;
  /** Loop back to the first scene when the last one finishes. */
  loop: boolean;
  /** Raw meta.captionStyle as authored (scenes carry the validated,
   *  resolved value) — the style panel reads and writes this. */
  captionStyle?: string;
  /** `sync: true` marks the track as a voiceover locked to the scene
   *  timeline — the player keeps the audio clock at the timeline position
   *  (across skips, loops, and unmuting). Leave unset for music beds,
   *  which free-run and loop independently. */
  soundtrack?: { src: string; volume: number; sync?: boolean } | undefined;
  /** Overlay captions on the 4:3 embed canvas, as authored (true/false);
   *  undefined follows the voiceover — see src/content/embed-captions.ts. */
  embedCaptions?: boolean | undefined;
  /** The showcase-wide brand mark, resolved (see src/content/watermark.ts).
   *  Scenes carry their own copy — this is the setting, not what any one
   *  slide draws. */
  watermark?: Watermark | undefined;
  /** Asset key for the home-page card image (defaults to the app mark). */
  cover?: string | undefined;
  /** Showcase-level authoring notes (see Scene.note) — never rendered in
   *  the player or exports; shown on the script page. */
  notes?: string | undefined;
  /** True when meta.source names a master recording — this showcase's
   *  voiceover, clips, word timings and scene durations are all built
   *  from its cut list (server/build-plan.mjs). The studio offers a
   *  "Build media" button for these; the player itself is unaffected,
   *  because the build writes ordinary durationMs pins and assets. */
  builtFromRecording: boolean;
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
      /** As authored — checked and resolved in buildShowcase. */
      tiktok?: unknown;
      fadeTo?: { asset: string; alt: string; align?: MediaAlign };
    }
  | {
      kind: "graphic";
      graphic: string;
      alt: string;
      motion?: SceneMotion;
      frame?: "phone" | "full" | "mark";
    };

type RawScene = Omit<
  Scene,
  "media" | "captions" | "body" | "durationMs" | "theme" | "warnings" | "captionStyle" | "watermark"
> & {
  /** As authored: false opts this slide out of the showcase's brand
   *  mark, true forces it on, a map overrides a field or two. */
  watermark?: unknown;
  /** As authored — normalized (with linter warnings) in buildShowcase. */
  theme?: string;
  media?: RawMedia;
  captions?: SceneCaption[];
  durationMs?: number;
  /** As authored — validated (with a linter warning) in buildShowcase. */
  captionStyle?: string;
  /** Obsolete (titles are no longer spoken) — linted. */
  titleDurationMs?: number;
  /** Obsolete (captions always show in the transcript column) — linted. */
  captionsIn?: string;
};

type RawDoc = {
  meta: {
    title: string;
    description: string;
    loop: boolean;
    soundtrack?: { src: string; volume: number; sync?: boolean };
    cover?: string;
    notes?: string;
    /** Reading speed in words per second for derived timing (default 3). */
    pace?: number;
    /** The master recording this showcase is cut from, when it is one.
     *  Read by the build (server/build-plan.mjs), ignored here: the build
     *  writes the durationMs pins the player actually follows. */
    source?: Record<string, unknown>;
    /** Default overlay caption painting for every scene (see CaptionStyle). */
    captionStyle?: string;
    /** Overlay captions on the 4:3 embed canvas — validated (with a linter
     *  warning) in buildShowcase; unset follows the voiceover. */
    embedCaptions?: unknown;
    /** The showcase's persistent brand mark — validated (with linter
     *  warnings) in buildShowcase; see src/content/watermark.ts. */
    watermark?: unknown;
    /** How every scene's picture goes into TikTok's 9:16 frame, unless
     *  the scene's media says otherwise — see src/content/tiktok-fit.ts. */
    tiktok?: unknown;
    theme?: Record<string, string>;
  };
  scenes: RawScene[];
};

/* -------------------------------------------------------------
 * SHOWCASE THEME — showcases/<id>/theme.yaml
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
      /* Overlay caption painting: the chip background, the text, and the
       * word being spoken (karaoke/reveal styles). */
      "caption-chip",
      "caption-text",
      "caption-word",
      /* The brand mark's wordmark (watermark.ts) — white unless set. */
      "watermark-text",
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
  const file = `showcases/${showcaseId}/theme.yaml`;
  const groups = Object.keys(THEME_GROUPS);
  for (const key of Object.keys(doc)) {
    if (key !== "extends" && !groups.includes(key)) {
      throw new Error(
        `Unknown section "${key}" in ${file} — expected: extends, ${groups.join(", ")}`,
      );
    }
  }
  if (doc.extends != null && typeof doc.extends !== "string") {
    throw new Error(`"extends" in ${file} must be a showcase id (folder name under showcases/)`);
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

/** The warning for a theme value YAML cut short (see looksCutOff). The
 *  value is left out rather than failing the showcase: one bad value in
 *  a parent theme must not take down every showcase that extends it. */
function cutOffWarning(where: string, value: string): string {
  return (
    `${where} looks cut off: "${value}", so it is left out. In YAML a space followed ` +
    `by # starts a comment — put the whole value in quotes.`
  );
}

function validateMetaTheme(showcaseId: string, theme: Record<string, string>): void {
  for (const [name, value] of Object.entries(theme)) {
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
const graphicModules = import.meta.glob("../../showcases/*/graphics/*.tsx", {
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
  entries.set(key, { component, file: `showcases/${showcaseId}/graphics/${filename}` });
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
      `or bundled under showcases/)`,
  );
}

const assetsByShowcase = new Map<string, Map<string, ShowcaseAsset>>();
/** Voiceover word-timestamp sidecars, keyed by audio asset key. */
const wordTimingsByShowcase = new Map<string, Map<string, string>>();

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

/** A stand-in image for a missing asset or graphic: renders the missing
 *  key on a dashed frame, so the slide keeps working while its files are
 *  still arriving (a new showcase's YAML often lands before its media). */
function placeholderAsset(key: string): ShowcaseAsset {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="1434" viewBox="0 0 660 1434">` +
    `<rect width="660" height="1434" fill="#0b101d"/>` +
    `<rect x="40" y="40" width="580" height="1354" fill="none" stroke="#3a4358" ` +
    `stroke-width="3" stroke-dasharray="16 14" rx="24"/>` +
    `<text x="330" y="690" fill="#8b93a7" font-family="ui-monospace,Menlo,monospace" ` +
    `font-size="30" text-anchor="middle">missing asset</text>` +
    `<text x="330" y="740" fill="#c7cddb" font-family="ui-monospace,Menlo,monospace" ` +
    `font-size="34" text-anchor="middle">${key.replace(/[<>&]/g, "")}</text>` +
    `</svg>`;
  return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, file: `${key} (missing)` };
}

function resolveMedia(
  showcaseId: string,
  media: RawMedia | undefined,
  warn: (message: string) => void,
): SceneMedia {
  if (!media || media.kind === "none") return { kind: "none" };
  /* A missing asset or graphic renders as a placeholder with a linter
   * warning, not a broken showcase. */
  const assetOr = (key: string): ShowcaseAsset => {
    try {
      return resolveAsset(showcaseId, key);
    } catch (error) {
      warn(String(error instanceof Error ? error.message : error));
      return placeholderAsset(key);
    }
  };
  if (media.kind === "graphic") {
    try {
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
    } catch (error) {
      warn(String(error instanceof Error ? error.message : error));
      const stand = placeholderAsset(media.graphic);
      return { kind: "image", src: stand.url, file: stand.file, alt: media.alt };
    }
  }
  const asset = assetOr(media.asset);
  const fadeTo = media.fadeTo ? assetOr(media.fadeTo.asset) : undefined;
  /* A kind that doesn't match the file (kind: image on an .mp4) renders a
   * broken image — say so instead of leaving the author to guess. */
  const mismatch = mediaKindWarning(media.kind, media.asset, asset.file);
  if (mismatch) warn(mismatch);
  if (media.fadeTo && fadeTo) {
    const fadeMismatch = mediaKindWarning("image", media.fadeTo.asset, fadeTo.file, "fadeTo");
    if (fadeMismatch) warn(fadeMismatch);
  }
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
    fadeTo:
      media.fadeTo && fadeTo
        ? {
            src: fadeTo.url,
            alt: media.fadeTo.alt,
            asset: media.fadeTo.asset,
            file: fadeTo.file,
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
const rawTexts = new Map<string, string>();
const themeDocs = new Map<string, RawTheme>();
const rawThemeTexts = new Map<string, string>();
const resolvedThemes = new Map<string, ResolvedTheme>();
/** Warnings from resolving each theme (own and inherited), cached and
 *  cleared with resolvedThemes; buildShowcase reports them. */
const themeWarnings = new Map<string, string[]>();

function resolveTheme(showcaseId: string, stack: string[] = []): ResolvedTheme {
  const cached = resolvedThemes.get(showcaseId);
  if (cached) return cached;
  if (stack.includes(showcaseId)) {
    throw new Error(`Theme "extends" cycle: ${[...stack, showcaseId].join(" -> ")}`);
  }

  const doc = themeDocs.get(showcaseId) ?? {};
  let vars: Record<string, string> = {};
  const fontLoads: string[] = [];
  const warnings: string[] = [];

  if (doc.extends) {
    if (!rawDocs.has(doc.extends)) {
      throw new Error(
        `Showcase "${showcaseId}" extends unknown showcase "${doc.extends}" — ` +
          `expected a folder under showcases/ with a showcase.yaml`,
      );
    }
    const parent = resolveTheme(doc.extends, [...stack, showcaseId]);
    vars = { ...parent.vars };
    fontLoads.push(...parent.fontLoads);
    warnings.push(...(themeWarnings.get(doc.extends) ?? []));
  }

  for (const [group, keys] of Object.entries(THEME_GROUPS)) {
    const section = doc[group as keyof RawTheme];
    if (section == null || typeof section !== "object") continue;
    for (const [key, value] of Object.entries(section)) {
      if (group === "fonts" && key === "load") continue;
      if (typeof value === "string" && looksCutOff(value)) {
        const file = `showcases/${showcaseId}/theme.yaml`;
        warnings.push(cutOffWarning(`"${group}.${key}" in ${file}`, value));
        continue;
      }
      vars[keys[key]!] = String(value);
    }
  }
  const load = doc.fonts?.["load"];
  if (Array.isArray(load)) fontLoads.push(...(load as string[]));

  const metaTheme = rawDocs.get(showcaseId)?.meta.theme;
  if (metaTheme) {
    validateMetaTheme(showcaseId, metaTheme);
    for (const [name, value] of Object.entries(metaTheme)) {
      if (typeof value === "string" && looksCutOff(value)) {
        warnings.push(cutOffWarning(`meta.theme "${name}" in showcase "${showcaseId}"`, value));
        continue;
      }
      vars[name] = value;
    }
  }

  const resolved: ResolvedTheme = { vars, fontLoads: [...new Set(fontLoads)] };
  resolvedThemes.set(showcaseId, resolved);
  themeWarnings.set(showcaseId, warnings);
  return resolved;
}

/** `soundtrack.src` may be an asset key (like scene media), a root-relative
 *  path, or a full URL. Asset keys resolve to the served asset URL; anything
 *  else passes through untouched. */
function resolveSoundtrack(showcaseId: string, soundtrack: RawDoc["meta"]["soundtrack"]) {
  if (!soundtrack) return undefined;
  const asset = soundtrack.src ? assetsByShowcase.get(showcaseId)?.get(soundtrack.src) : undefined;
  /* `volume` is optional in the file — the edit tools write a soundtrack
   * without one — so fill it in here. Full volume is what a voiceover
   * wants, and it is what the video export already assumed. */
  const volume = Number(soundtrack.volume);
  return {
    ...soundtrack,
    volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
    ...(asset ? { src: asset.url } : {}),
  };
}

/** Points a resolved watermark's mark image at its served URL. As with
 *  `soundtrack.src`, `asset` may be an asset key, a root-relative path,
 *  or a full URL — a path or URL passes through untouched. A key with no
 *  file warns and gets no `src`, so the image isn't drawn (a text-only
 *  bug still draws); `file` names it "(missing)", as scene media does,
 *  so the assets page can list it. The mark is drawn as an image, so a
 *  video or audio file warns and isn't drawn either. */
function resolveWatermarkAsset(
  showcaseId: string,
  spec: WatermarkSpec | undefined,
  warn: (message: string) => void,
): Watermark | undefined {
  if (!spec) return undefined;
  if (!spec.asset) return spec;
  const notAnImage = (file: string) => {
    const kind = assetKind(file.replace(/[?#].*$/, ""));
    if (kind === "image" || kind === "other") return false;
    warn(
      `watermark asset "${spec.asset}" is ${kind === "audio" ? "an" : "a"} ${kind} file — ` +
        `the brand mark needs an image, so it is drawn without it`,
    );
    return true;
  };
  if (/^(https?:)?\/\//.test(spec.asset) || spec.asset.startsWith("/")) {
    return notAnImage(spec.asset) ? spec : { ...spec, src: spec.asset };
  }
  const entry = assetsByShowcase.get(showcaseId)?.get(spec.asset);
  if (entry) {
    return notAnImage(entry.file)
      ? { ...spec, file: entry.file }
      : { ...spec, src: entry.url, file: entry.file };
  }
  warn(
    `watermark asset "${spec.asset}" has no file in the showcase's assets/ folder — ` +
      `drawing the brand mark without it`,
  );
  return { ...spec, file: `${spec.asset} (missing)` };
}

const KNOWN_THEMES = new Set<SceneTheme>(["statement", "feature", "console", "footage"]);

/** THEME LINTER — normalizes each scene's theme and flags what doesn't
 *  add up. Warnings never block rendering: a legacy or unknown theme is
 *  mapped to the closest layout and the scene renders from the flags it
 *  has set. */
function lintScene(raw: RawScene): { theme: SceneTheme; warnings: string[] } {
  const warnings: string[] = [];
  const authored = raw.theme ?? "";
  let theme: SceneTheme;
  if (KNOWN_THEMES.has(authored as SceneTheme)) {
    theme = authored as SceneTheme;
  } else if (authored === "title") {
    theme = "statement";
    warnings.push(`theme "title" is now "statement" — rename it`);
  } else {
    // Infer the layout from the media so the scene still renders.
    const media = raw.media;
    theme =
      media?.kind === "graphic"
        ? "console"
        : media && media.kind !== "none" && media.frame === "full"
          ? "footage"
          : media && media.kind !== "none" && media.frame !== "mark"
            ? "feature"
            : "statement";
    warnings.push(
      authored
        ? `unknown theme "${authored}" — rendering as "${theme}" (themes: statement, feature, console, footage)`
        : `no theme set — rendering as "${theme}"`,
    );
  }
  if (theme === "feature" && raw.media && raw.media.kind !== "none" && raw.media.frame === "full") {
    theme = "footage";
    warnings.push(`a feature scene with frame: full media is footage — use theme: footage`);
  }
  if (theme === "footage" && raw.title) {
    warnings.push(`footage doesn't display a title — remove it (the eyebrow labels the script)`);
  }
  if (raw.captionsIn != null) {
    warnings.push(
      `captionsIn is obsolete — captions always show in the transcript column, and the overlay follows the presentation toggle`,
    );
  }
  if (raw.titleDurationMs != null) {
    warnings.push(
      `titleDurationMs is obsolete — titles are never spoken; time the captions instead`,
    );
  }
  return { theme, warnings };
}

const CAPTION_STYLES = new Set<CaptionStyle>(["chip", "karaoke", "reveal"]);

/** Validates an authored captionStyle; unknown values warn and fall back
 *  to the default painting. */
function resolveCaptionStyle(
  authored: string | undefined,
  warn: (message: string) => void,
): CaptionStyle | undefined {
  if (authored == null) return undefined;
  if (CAPTION_STYLES.has(authored as CaptionStyle)) return authored as CaptionStyle;
  warn(`unknown captionStyle "${authored}" — using "chip" (styles: chip, karaoke, reveal)`);
  return undefined;
}

function buildShowcase(
  showcaseId: string,
  doc: RawDoc,
  warn: (sceneId: string, message: string) => void,
): Showcase {
  /* The showcase's brand mark, validated once (its warnings belong to
   *  the showcase, not to whichever scene is drawn first). */
  const showcaseTheme = resolveTheme(showcaseId);
  for (const message of themeWarnings.get(showcaseId) ?? []) warn("", message);
  const baseWatermark = readWatermark(doc.meta.watermark, "meta.watermark", (message) =>
    warn("", message),
  );
  const baseTikTok = readTikTokFit(doc.meta.tiktok, "meta.tiktok", (message) => warn("", message));
  const scenes: Scene[] = doc.scenes.map((raw) => {
    const {
      titleDurationMs: _titleDurationMs,
      captionsIn: _captionsIn,
      watermark: authoredWatermark,
      ...scene
    } = raw;
    const { theme, warnings } = lintScene(raw);
    const resolvedMedia = resolveMedia(showcaseId, scene.media, (message) =>
      warnings.push(message),
    );
    const rawMedia = scene.media;
    const ownTikTok =
      rawMedia && "tiktok" in rawMedia
        ? readTikTokFit(rawMedia.tiktok, "media.tiktok", (message) => warnings.push(message))
        : undefined;
    const media =
      resolvedMedia.kind === "image" || resolvedMedia.kind === "video"
        ? {
            ...resolvedMedia,
            tiktok: resolveTikTokFit(ownTikTok, baseTikTok, resolvedMedia),
            ...(ownTikTok ? { tiktokOwn: ownTikTok } : {}),
          }
        : resolvedMedia;
    const captionStyle = resolveCaptionStyle(raw.captionStyle ?? doc.meta.captionStyle, (message) =>
      warnings.push(message),
    );
    /* A statement slide whose media IS the mark shows the logo full size
     * already — the small corner copy would be a second one. */
    const sceneShowsMark = theme === "statement" && media.kind !== "none" && media.frame === "mark";
    const watermarkSpec = resolveWatermark(
      baseWatermark,
      authoredWatermark,
      { sceneShowsMark },
      (message) => warnings.push(message),
    );
    /* A missing file for the showcase's own mark is reported once, below;
     * a scene reports only an asset it named itself. */
    const ownAsset = watermarkSpec?.asset !== baseWatermark?.asset;
    const watermark = resolveWatermarkAsset(showcaseId, watermarkSpec, (message) => {
      if (ownAsset) warnings.push(message);
    });
    const resolved = resolveSceneTiming(raw, doc.meta.pace);
    /* An unknown caption position is dropped (the caption falls back to
     * the default) and reported, rather than leaving the line unplaced. */
    const captions = resolved.captions.map((caption, i) => {
      if (caption.position == null || isCaptionPosition(caption.position)) return caption;
      warnings.push(
        `captions[${i}].position "${caption.position}" isn't a position — using "bottom" ` +
          `(positions: ${CAPTION_POSITION_HELP})`,
      );
      const { position: _position, ...placed } = caption;
      return placed;
    });
    const timing = { ...resolved, captions };
    warnings.forEach((message) => warn(raw.id, message));
    return {
      ...scene,
      ...timing,
      theme,
      body: timing.captions[0]?.text,
      media,
      captionStyle,
      ...(watermark ? { watermark } : {}),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  });
  /* Whisper-exact caption words: when the soundtrack has a
   * word-timestamp sidecar (assets/<src>.words.json — the transcribe
   * tool's output), align it to the narration so worded caption styles
   * follow the actual voiceover instead of the synthetic pacing. */
  const wordsJson = wordTimingsByShowcase.get(showcaseId)?.get(doc.meta.soundtrack?.src ?? "");
  if (wordsJson) {
    try {
      alignCaptionWords(scenes, JSON.parse(wordsJson));
    } catch (error) {
      warn(
        "",
        `voiceover word timings ignored: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  /* A meta.watermark with nothing to draw (the asset line forgotten, or
   * misspelled) would otherwise just not appear, with no reason given.
   * Fine when a scene supplies the image or wordmark itself. */
  if (
    baseWatermark &&
    !baseWatermark.asset &&
    !baseWatermark.text &&
    !scenes.some((scene) => scene.watermark)
  ) {
    warn("", "meta.watermark needs an asset, a text wordmark, or both — no brand mark is drawn");
  }
  const authoredEmbedCaptions = doc.meta.embedCaptions;
  const embedCaptions =
    typeof authoredEmbedCaptions === "boolean" ? authoredEmbedCaptions : undefined;
  if (authoredEmbedCaptions != null && embedCaptions === undefined) {
    warn(
      "",
      `embedCaptions must be true or false — ignoring "${String(authoredEmbedCaptions)}" (unset follows the voiceover)`,
    );
  }
  return {
    id: showcaseId,
    ...doc.meta,
    builtFromRecording: Boolean(doc.meta.source),
    embedCaptions,
    watermark: resolveWatermarkAsset(
      showcaseId,
      resolveWatermark(baseWatermark, true, {}, () => {}),
      (message) => warn("", message),
    ),
    soundtrack: resolveSoundtrack(showcaseId, doc.meta.soundtrack),
    theme: showcaseTheme,
    scenes,
    /* footage defaults out of the screenshot set (a paused frame of
     * someone mid-sentence isn't an App Store screenshot). */
    exportScenes: scenes.filter(
      (scene) => (scene.export ?? (scene.theme !== "footage" ? true : false)) !== false,
    ),
  };
}

/** Loads a library from a source, replacing whatever was loaded before.
 *  The app calls it once, below; it is exported so tests can load a small
 *  library from a fake source. */
export async function loadFromSource(source: ShowcaseSource): Promise<Showcase[]> {
  const data = await source.load();
  rawDocs.clear();
  rawTexts.clear();
  themeDocs.clear();
  rawThemeTexts.clear();
  resolvedThemes.clear();
  themeWarnings.clear();
  assetsByShowcase.clear();
  wordTimingsByShowcase.clear();
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
    wordTimingsByShowcase.set(entry.id, entry.words);
    dataGraphicsByShowcase.set(entry.id, entry.graphics);
    try {
      rawDocs.set(entry.id, parse(entry.yaml) as RawDoc);
      rawTexts.set(entry.id, entry.yaml);
      if (entry.themeYaml != null) {
        const doc = (parse(entry.themeYaml) ?? {}) as RawTheme;
        validateThemeDoc(entry.id, doc);
        themeDocs.set(entry.id, doc);
        rawThemeTexts.set(entry.id, entry.themeYaml);
      }
    } catch (error) {
      rawDocs.delete(entry.id);
      rawTexts.delete(entry.id);
      rawThemeTexts.delete(entry.id);
      fail(entry.id, error);
    }
  }
  const built: Showcase[] = [];
  const warnings: ShowcaseWarning[] = [];
  for (const [showcaseId, doc] of rawDocs) {
    try {
      built.push(
        buildShowcase(showcaseId, doc, (sceneId, message) =>
          warnings.push({ showcaseId, sceneId, message }),
        ),
      );
    } catch (error) {
      fail(showcaseId, error);
    }
  }
  showcases = built.sort((a, b) => a.title.localeCompare(b.title));
  showcaseErrors = errors;
  showcaseWarnings = warnings;
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

/** Theme-linter warnings from this load — shown in the diagnostics tray
 *  and beside the affected scene in the player. Warnings never block
 *  rendering. */
export type ShowcaseWarning = { showcaseId: string; sceneId: string; message: string };
export let showcaseWarnings: ShowcaseWarning[] = [];

export const showcasesReady: Promise<Showcase[]> = loadFromSource(activeSource());

/* The loaded library, for the studio's validate tool (server/exporter.mjs),
 * which opens a page and reads it from there. It's a page global, not a
 * module import, so validate also works in the packaged app, where no dev
 * server serves source files. */
declare global {
  interface Window {
    __showcaseLibrary?: () => Promise<{
      showcases: Showcase[];
      errors: ShowcaseError[];
      warnings: ShowcaseWarning[];
    }>;
  }
}
if (typeof window !== "undefined") {
  window.__showcaseLibrary = async () => {
    await showcasesReady;
    return { showcases, errors: showcaseErrors, warnings: showcaseWarnings };
  };
}

export function getShowcase(id: string): Showcase | undefined {
  return showcases.find((showcase) => showcase.id === id);
}

/* -------------------------------------------------------------
 * IN-APP EDITING — the surgical update path.
 *
 * External file changes still arrive as a full page reload (the studio
 * watcher). In-app edits must not: they are known patches, so they are
 * applied straight to the model here — mutate the raw doc, rebuild just
 * that showcase, notify subscribers — while the desktop shell writes the
 * same edit to showcase.yaml and swallows the watcher echo. Mounted
 * components re-render through useShowcase; nothing reloads, nothing
 * flashes.
 * ------------------------------------------------------------- */

let editRevision = 0;
const editListeners = new Set<() => void>();

function subscribeShowcases(listener: () => void): () => void {
  editListeners.add(listener);
  return () => editListeners.delete(listener);
}

const readEditRevision = () => editRevision;

/** The showcase, re-read whenever an in-app edit rebuilds it. */
export function useShowcase(id: string): Showcase | undefined {
  useSyncExternalStore(subscribeShowcases, readEditRevision, readEditRevision);
  return getShowcase(id);
}

function rebuildShowcase(showcaseId: string): boolean {
  const doc = rawDocs.get(showcaseId);
  if (!doc) return false;
  const warnings = showcaseWarnings.filter((warning) => warning.showcaseId !== showcaseId);
  try {
    const built = buildShowcase(showcaseId, doc, (sceneId, message) =>
      warnings.push({ showcaseId, sceneId, message }),
    );
    showcases = showcases.map((showcase) => (showcase.id === showcaseId ? built : showcase));
    showcaseWarnings = warnings;
    editRevision += 1;
    for (const listener of editListeners) listener();
    return true;
  } catch (error) {
    console.error(`Showcase "${showcaseId}" failed to rebuild after an edit:`, error);
    return false;
  }
}

/** The YAML text this page loaded for a showcase — the base its first
 *  in-app edit is made against (src/lib/edits.ts hashes it; after that,
 *  the shell's returned hash tracks the file). */
export function showcaseYamlText(showcaseId: string): string | undefined {
  return rawTexts.get(showcaseId);
}

/** Same, for theme.yaml (style-panel edits); undefined when the showcase
 *  has no theme file yet. */
export function showcaseThemeText(showcaseId: string): string | undefined {
  return rawThemeTexts.get(showcaseId);
}

/** Applies one style-panel theme edit to the in-memory model (see the
 *  "theme" SceneEdit variant) and returns the inverse edit, or undefined
 *  when the rebuild fails. The resolved-theme cache is invalidated so
 *  the layout route re-applies the CSS variables in place. */
export function applyThemeEditLocal(
  showcaseId: string,
  edit: { group: "colors" | "atmosphere"; name: string; value: string },
): SceneEdit | undefined {
  if (!rawDocs.has(showcaseId)) return undefined;
  const doc = themeDocs.get(showcaseId) ?? {};
  const group = (doc[edit.group] ?? {}) as Record<string, unknown>;
  const previous = typeof group[edit.name] === "string" ? (group[edit.name] as string) : "";
  const put = (value: string) => {
    if (value) group[edit.name] = value;
    else delete group[edit.name];
    doc[edit.group] = group;
    themeDocs.set(showcaseId, doc);
    resolvedThemes.clear();
    themeWarnings.clear();
  };
  put(edit.value);
  if (rebuildShowcase(showcaseId)) {
    return { field: "theme", group: edit.group, name: edit.name, value: previous };
  }
  put(previous);
  return undefined;
}

/** Applies one whitelisted scene edit to the in-memory model (see
 *  SceneEdit in src/lib/studio.ts) and returns the inverse edit — the
 *  undo entry — or undefined when the target doesn't exist. Derived data
 *  (caption timing, slide durations, warnings) recomputes on the way. */
export function applySceneEditLocal(
  showcaseId: string,
  sceneId: string,
  edit: SceneEdit,
): SceneEdit | undefined {
  const doc = rawDocs.get(showcaseId);
  if (!doc) return undefined;
  /* Meta edits address the showcase, not a scene (sceneId is ignored). */
  if (edit.field === "meta.captionStyle") {
    const previous = (doc.meta.captionStyle ?? "") as "" | "chip" | "karaoke" | "reveal";
    if (edit.value) doc.meta.captionStyle = edit.value;
    else delete doc.meta.captionStyle;
    if (rebuildShowcase(showcaseId)) return { field: "meta.captionStyle", value: previous };
    if (previous) doc.meta.captionStyle = previous;
    else delete doc.meta.captionStyle;
    return undefined;
  }
  if (edit.field === "meta.set") {
    const had = "embedCaptions" in doc.meta;
    const previous = doc.meta.embedCaptions;
    if (typeof edit.value === "boolean") doc.meta.embedCaptions = edit.value;
    else delete doc.meta.embedCaptions;
    if (rebuildShowcase(showcaseId)) {
      return {
        field: "meta.set",
        name: "embedCaptions",
        value: typeof previous === "boolean" ? previous : null,
      };
    }
    if (had) doc.meta.embedCaptions = previous;
    else delete doc.meta.embedCaptions;
    return undefined;
  }
  /* Theme edits are routed to applyThemeEditLocal, never here. */
  if (edit.field === "theme") return undefined;
  /* Scene insertion addresses a position, not a scene. */
  if (edit.field === "scene.insert") {
    if (!Number.isInteger(edit.index) || edit.index < 0 || edit.index > doc.scenes.length) {
      return undefined;
    }
    if (doc.scenes.some((scene) => scene.id === edit.scene.id)) return undefined;
    doc.scenes.splice(edit.index, 0, structuredClone(edit.scene) as unknown as RawScene);
    if (rebuildShowcase(showcaseId)) return { field: "scene.delete" };
    doc.scenes.splice(edit.index, 1);
    return undefined;
  }
  const raw = doc.scenes.find((scene) => scene.id === sceneId);
  if (!raw) return undefined;
  if (edit.field === "scene.delete") {
    const index = doc.scenes.indexOf(raw);
    const removed = structuredClone(raw) as unknown as { id: string } & Record<string, unknown>;
    doc.scenes.splice(index, 1);
    if (rebuildShowcase(showcaseId)) return { field: "scene.insert", index, scene: removed };
    doc.scenes.splice(index, 0, raw);
    return undefined;
  }
  /* If the rebuild below fails, the doc must roll back too — the model
   * keeps its last good state, and a lingering mutation would resurface
   * with the next successful edit. */
  const snapshot = structuredClone(raw);
  let inverse: SceneEdit;
  if (edit.field === "title") {
    inverse = { field: "title", value: raw.title ?? "" };
    const title = edit.value.trim();
    if (title) raw.title = title;
    else delete raw.title;
  } else if (edit.field === "caption") {
    const caption = raw.captions?.[edit.captionIndex];
    if (!caption) return undefined;
    inverse = { field: "caption", captionIndex: edit.captionIndex, value: caption.text };
    caption.text = edit.value.trim();
  } else if (edit.field === "caption.insert") {
    const captions = (raw.captions ??= []);
    if (edit.captionIndex < 0 || edit.captionIndex > captions.length) return undefined;
    inverse = { field: "caption.delete", captionIndex: edit.captionIndex };
    captions.splice(edit.captionIndex, 0, structuredClone(edit.caption) as SceneCaption);
  } else if (edit.field === "caption.delete") {
    const caption = raw.captions?.[edit.captionIndex];
    if (!caption) return undefined;
    inverse = {
      field: "caption.insert",
      captionIndex: edit.captionIndex,
      caption: structuredClone(caption) as { text: string } & Record<string, unknown>,
    };
    raw.captions?.splice(edit.captionIndex, 1);
  } else if (edit.field === "media.set") {
    inverse = {
      field: "media.set",
      media: structuredClone(raw.media ?? { kind: "none" }) as { kind: string } & Record<
        string,
        unknown
      >,
    };
    raw.media = structuredClone(edit.media) as unknown as RawMedia;
  } else if (edit.field === "media.tiktok") {
    const media = raw.media;
    if (!media || media.kind === "none" || media.kind === "graphic") return undefined;
    const previous = media.tiktok;
    inverse = {
      field: "media.tiktok",
      value:
        previous && typeof previous === "object"
          ? (structuredClone(previous) as Extract<SceneEdit, { field: "media.tiktok" }>["value"])
          : null,
    };
    if (edit.value) media.tiktok = structuredClone(edit.value);
    else delete media.tiktok;
  } else {
    const media = raw.media;
    if (!media || media.kind === "none" || media.kind === "graphic") return undefined;
    inverse = { field: "media.asset", value: media.asset, mediaKind: media.kind };
    media.asset = edit.value;
    if (edit.mediaKind) media.kind = edit.mediaKind;
  }
  if (rebuildShowcase(showcaseId)) return inverse;
  doc.scenes[doc.scenes.indexOf(raw)] = snapshot;
  return undefined;
}

/* -------------------------------------------------------------
 * ASSET INVENTORY — the media collection behind a showcase, with usage,
 * for the assets page.
 * ------------------------------------------------------------- */

export type { AssetKind } from "./asset-kind";

export type AssetInfo = {
  /** The file name — always a valid reference key. */
  name: string;
  /** The bare key (name without extension) when it resolves to this file. */
  key: string;
  url: string;
  file: string;
  kind: AssetKind;
  /** Scene ids referencing it, plus "soundtrack" / "cover" when applicable. */
  usedBy: string[];
};

/** Every file in the showcase's assets folder with what references it,
 *  plus the keys that are referenced but have no file (rendering as
 *  placeholders). */
export function showcaseAssets(showcase: Showcase): {
  assets: AssetInfo[];
  missing: { key: string; usedBy: string[] }[];
} {
  const entries = assetsByShowcase.get(showcase.id) ?? new Map<string, ShowcaseAsset>();
  const usedBy = new Map<string, string[]>();
  const missing = new Map<string, string[]>();
  const mark = (map: Map<string, string[]>, key: string, by: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(by)) list.push(by);
    map.set(key, list);
  };
  const markFile = (file: string | undefined, by: string) => {
    if (!file) return;
    const gone = / \(missing\)$/.test(file);
    if (gone) mark(missing, file.replace(/ \(missing\)$/, ""), by);
    else mark(usedBy, file, by);
  };
  for (const scene of showcase.scenes) {
    const media = scene.media;
    if (media.kind === "image" || media.kind === "video") {
      markFile(media.file, scene.id);
      markFile(media.fadeTo?.file, scene.id);
    } else if (media.kind === "graphic") {
      markFile(media.file, scene.id);
    }
  }
  /* The brand mark is referenced from meta, not from a scene — without
   * this it would look unused on the assets page. A scene that names a
   * mark of its own is listed under that scene. (`file` is only set for
   * an asset key, never for a path or URL.) */
  markFile(showcase.watermark?.file, "watermark");
  for (const scene of showcase.scenes) {
    if (scene.watermark?.file !== showcase.watermark?.file) {
      markFile(scene.watermark?.file, scene.id);
    }
  }
  for (const [, entry] of entries) {
    if (showcase.soundtrack?.src && entry.url === showcase.soundtrack.src) {
      mark(usedBy, entry.file, "soundtrack");
      /* The voiceover's word timings are found by name, not by a field
       * anything points at (assets/<soundtrack-src>.words.json — see
       * buildShowcase). Without this the sidecar reads as unreferenced
       * on the assets page, which invites deleting the file that keeps
       * the karaoke captions on the real voice. */
      const name = entry.file.split("/").at(-1)!;
      const sidecar = entries.get(`${name.replace(/\.[^.]+$/, "")}.words.json`);
      if (sidecar) mark(usedBy, sidecar.file, "word timings");
      break;
    }
  }
  if (showcase.cover) {
    const cover = entries.get(showcase.cover);
    if (cover) mark(usedBy, cover.file, "cover");
    else mark(missing, showcase.cover, "cover");
  }

  const assets: AssetInfo[] = [];
  for (const [key, entry] of entries) {
    const name = entry.file.split("/").at(-1)!;
    if (key !== name) continue; // bare-key aliases point at the same file
    const bare = name.replace(/\.[^.]+$/, "");
    const ext = (name.split(".").at(-1) ?? "").toLowerCase();
    assets.push({
      name,
      key: entries.get(bare)?.file === entry.file ? bare : name,
      url: entry.url,
      file: entry.file,
      kind: ASSET_KINDS[ext] ?? "other",
      usedBy: usedBy.get(entry.file) ?? [],
    });
  }
  assets.sort((a, b) => a.name.localeCompare(b.name));
  return {
    assets,
    missing: [...missing.entries()].map(([key, by]) => ({ key, usedBy: by })),
  };
}

/** The home-page card image: `meta.cover` if set, else the first
 *  mark-framed asset, else the first image in the showcase. */
export function coverUrl(showcase: Showcase): string | undefined {
  if (showcase.cover) {
    // A missing cover is a card without an image, not a broken home page.
    try {
      return resolveAsset(showcase.id, showcase.cover).url;
    } catch {
      return undefined;
    }
  }
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
