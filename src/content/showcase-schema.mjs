/* The shape of showcase.yaml, in one place: every field, where it goes,
 * what it may hold. The loader (src/content/showcases.ts) checks each
 * document against it and reports what doesn't fit as warnings — an
 * unknown field, a field in the wrong place, a wrong type — so a
 * misplaced field is never silently ignored. A misplaced field's warning
 * says where it belongs ("clip" isn't a scene field: it goes in
 * scenes[].take), and a typo gets a "did you mean". Each warning is on
 * the scene or on the showcase. The studio writes it into
 * every library as .studio/showcase.schema.json, the field reference a
 * session reads beside the guide, and the edit tool's whitelists are
 * tested against it (server/edit-yaml.test.mjs), so the four can't drift.
 *
 * It is JSON Schema (the subset below), kept as data so one copy serves
 * the page, the studio and the reader. The values that other rule files
 * already decide — caption positions, TikTok fits, the brand mark, the
 * publish block, meta.theme's variable names — are imported from them,
 * never retyped. Plain ESM, like those files, so the server and the page
 * read one copy; types live in showcase-schema.d.mts.
 *
 * What checkShowcase understands of JSON Schema: type (string, number,
 * integer, boolean, object, array), properties, required,
 * additionalProperties (false, or a schema), items, enum, pattern,
 * minimum, maximum, anyOf. Nothing else is needed for showcase.yaml.
 *
 * A field's values are listed here for the reader, but some are judged
 * by the code that reads the field — the theme linter, the TikTok fit,
 * the brand mark, caption positions — with the fallback the player
 * applies. The loader keeps those messages and drops this file's
 * duplicates (VALUE_CHECKED_ELSEWHERE in showcases.ts). */

import { CAPTION_PRESETS, CAPTION_PERCENT } from "./caption-position-rules.mjs";
import {
  TIKTOK_AREA_SIDES,
  TIKTOK_BANDS,
  TIKTOK_FITS,
  TIKTOK_FOCUS_PRESETS,
} from "./tiktok-fit-rules.mjs";
import {
  WATERMARK_INSET,
  WATERMARK_OPACITY,
  WATERMARK_POSITIONS,
  WATERMARK_SCALE,
  WATERMARK_SHADE,
} from "./watermark-rules.mjs";
import { DESTINATIONS, PUBLISH_FIELDS } from "./publish-rules.mjs";
import { THEME_VARS } from "./theme-rules.mjs";
import { PLAYER_VIEWS } from "../lib/export-kinds.mjs";

export const SCENE_THEMES = ["statement", "feature", "console", "footage"];
export const CAPTION_STYLES = ["chip", "karaoke", "reveal"];
export const MEDIA_KINDS = ["none", "image", "video", "graphic"];
export const MEDIA_MOTIONS = ["zoom-in", "zoom-out", "pan-up", "pan-left", "still"];
export const MEDIA_FRAMES = ["phone", "full", "mark"];
export const MEDIA_ALIGNS = ["top", "center", "bottom"];
export const MEDIA_FITS = ["cover", "contain"];
export const CTA_KINDS = ["app-store", "github", "link"];
export const TRANSITIONS = ["rise", "none"];
export const VOICEOVER_ENGINES = ["generative", "neural", "standard", "long-form"];
export const TONEMAPS = ["hlg", "none"];

const PERCENT_PATTERN = "^\\d+(\\.\\d+)?%$";

const string = (description) => ({ type: "string", description });
const number = (description, range) => ({ type: "number", description, ...range });
const boolean = (description) => ({ type: "boolean", description });
const oneOf = (values, description) => ({ type: "string", enum: values, description });
const percent = (description) => ({ type: "string", pattern: PERCENT_PATTERN, description });
/** An object with these fields and no others. `title` names it in a
 *  warning ("isn't a scene field"). */
const object = (title, description, properties, required = []) => ({
  type: "object",
  title,
  description,
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

const TIKTOK_FIT = object(
  "TikTok fit",
  "How a picture goes into TikTok's 9:16 frame (the TikTok view and the video exports).",
  {
    fit: oneOf(TIKTOK_FITS, "fill crops the picture to the frame; fit shows it whole, with bands."),
    focus: {
      anyOf: [{ type: "string", enum: TIKTOK_FOCUS_PRESETS }, percent()],
      description:
        "Which part a fill keeps: top, center, bottom, or a percentage (0% keeps the top, 100% the bottom).",
    },
    bands: oneOf(
      TIKTOK_BANDS,
      "What fills the frame around a fit picture: a blur of it, or a color.",
    ),
    area: object(
      "TikTok fit area",
      "Insets from the frame's edges the picture's box starts at, in percent; a side left out is 0%.",
      Object.fromEntries(TIKTOK_AREA_SIDES.map((side) => [side, percent()])),
    ),
  },
);

const WATERMARK = {
  anyOf: [
    boolean(),
    object("brand mark", "The brand mark drawn in a corner of every slide.", {
      asset: string("The mark's image, by asset key."),
      text: string("A wordmark drawn beside or instead of the image."),
      position: oneOf(WATERMARK_POSITIONS, "The corner it sits in."),
      inset: percent(
        `How far from the frame's edge it is pushed, to clear a platform's interface (${WATERMARK_INSET.min}–${WATERMARK_INSET.max}%).`,
      ),
      shade: {
        anyOf: [
          boolean(),
          number(undefined, { minimum: WATERMARK_SHADE.min, maximum: WATERMARK_SHADE.max }),
        ],
        description: "A dark panel behind the mark: true, false, or its opacity.",
      },
      opacity: number("The mark's opacity.", {
        minimum: WATERMARK_OPACITY.min,
        maximum: WATERMARK_OPACITY.max,
      }),
      scale: number("The mark's size, 1 being the default.", {
        minimum: WATERMARK_SCALE.min,
        maximum: WATERMARK_SCALE.max,
      }),
    }),
  ],
  description:
    "false leaves the mark off this slide, true forces it on, a map sets or overrides its fields.",
};

const SPAN = object(
  "span",
  "A span of the master recording, in seconds.",
  {
    from: number("Where the span starts, in seconds of the recording."),
    to: number("Where it ends."),
    fit: number("Seconds the span plays in, to fast-forward it (the picture only)."),
    clip: boolean(
      "Whether the build cuts a clip of the recording for this scene: footage scenes do by default, other themes don't. false on a footage scene that shows its own media (a cutaway, the app mark).",
    ),
  },
  ["from", "to"],
);
const SPAN_LIST = {
  type: "array",
  items: SPAN,
  description: "Spans, in order; what's between them is dropped.",
};
const SPANS = { anyOf: [SPAN, SPAN_LIST] };

const TAKE = {
  anyOf: [
    SPAN,
    SPAN_LIST,
    object("silence", "A card with nothing spoken over it.", {
      silence: number("Seconds of silence the voiceover gets here."),
      clip: boolean("Never cut a clip for a silence; leave it out."),
    }),
    object(
      "take with sides",
      "The sound and the picture cut on their own spans; they must last the same.",
      {
        audio: SPANS,
        video: SPANS,
        clip: boolean("Whether the build cuts a clip for this scene (see span.clip)."),
      },
    ),
  ],
  description:
    "The span of the master recording this scene owns, on a showcase with meta.source: {from, to}, a list of them, {silence}, or {audio, video}. clip goes inside it.",
};

const CAPTION = object(
  "caption",
  "One spoken line of the narration.",
  {
    text: string("The words, exactly as spoken."),
    durationMs: number("Pins how long the line shows; derived from the words when unset."),
    position: {
      anyOf: [{ type: "string", enum: CAPTION_PRESETS }, percent()],
      description: `Where the overlay caption sits: ${CAPTION_PRESETS.join(", ")}, or a height like "14%" (${CAPTION_PERCENT.min}–${CAPTION_PERCENT.max}%).`,
    },
  },
  ["text"],
);

const MEDIA = object(
  "media",
  "What the scene shows.",
  {
    kind: oneOf(MEDIA_KINDS, "none, image, video, or graphic (a TSX diagram in graphics/)."),
    asset: string("The image or video, by asset key (the file name without its extension)."),
    graphic: string("The graphic, by key (its file name in graphics/ without the extension)."),
    alt: string("What the picture shows, for accessibility."),
    motion: oneOf(MEDIA_MOTIONS, "The slow move on the picture; still for none."),
    frame: oneOf(
      MEDIA_FRAMES,
      "phone frames it in a device, full is edge to edge, mark is an app-icon tile.",
    ),
    align: oneOf(MEDIA_ALIGNS, "Which edge stays visible when the picture is cropped."),
    fit: oneOf(MEDIA_FITS, "cover crops to fill, contain shows the whole picture."),
    speed: number(
      "A video clip's playing rate, 0.25 to 4: the player and every export play it that fast, so a long screen recording runs shorter without re-encoding.",
      { minimum: 0.25, maximum: 4 },
    ),
    tiktok: TIKTOK_FIT,
    overlay: string("A graphic drawn over the picture, by key."),
    fadeTo: object("fadeTo", "A second picture that cross-fades in midway through the scene.", {
      asset: string("The picture, by asset key."),
      alt: string("What it shows."),
      align: oneOf(MEDIA_ALIGNS),
    }),
  },
  ["kind"],
);

const SCENE = object(
  "scene",
  "One slide.",
  {
    id: string("The scene's name: a short slug, unique in the showcase."),
    theme: oneOf(SCENE_THEMES, "The layout: statement, feature, console, or footage."),
    title: string("On-screen display text; never spoken. Omit it on footage."),
    eyebrow: string("A label for the script and teleprompter pages; never on the slide."),
    note: string("An authoring note; shown on the script page, never rendered."),
    captions: { type: "array", items: CAPTION, description: "The narration, in order." },
    captionStyle: oneOf(
      CAPTION_STYLES,
      "How the overlay caption paints: chip, karaoke, or reveal.",
    ),
    media: MEDIA,
    support: string("A smaller line under the body (statement)."),
    cta: object(
      "cta",
      "A call-to-action button under the body (statement).",
      {
        label: string(),
        url: string(),
        kind: oneOf(
          CTA_KINDS,
          "app-store draws the App Store badge, github the GitHub badge, link a plain button.",
        ),
      },
      ["label", "url"],
    ),
    ctaNote: string("A small line under the button."),
    durationMs: number(
      "Pins the slide's length; derived from the captions when unset, and written by the build on a recorded or voiced showcase.",
    ),
    maxMs: number(
      "The longest this scene should run, in ms; overrides meta.sceneMaxMs. A warning when it runs longer, not a change to the timing.",
    ),
    export: boolean("Whether the slide is in the App Store screenshot set (footage defaults out)."),
    watermark: WATERMARK,
    transition: oneOf(TRANSITIONS, "rise opts into the entrance animation; off by default."),
    take: TAKE,
    titleDurationMs: {
      type: "number",
      deprecated: true,
      description: "Obsolete: titles are never spoken.",
    },
    captionsIn: {
      type: "string",
      deprecated: true,
      description: "Obsolete: captions always show in the transcript column.",
    },
  },
  ["id"],
);

const META = object(
  "meta",
  "The showcase itself.",
  {
    title: string("The showcase's name."),
    description: string("One line about it; the default caption a post goes out with."),
    loop: boolean("Whether the player loops back to the first scene."),
    pace: number("Reading speed for derived timing, in words per second (default 2.5)."),
    sceneMaxMs: number(
      "The longest any scene should run, in ms (8000 suits a product video); a scene's own maxMs overrides it. The linter warns past it.",
    ),
    targetMs: number(
      "What the whole video should add up to, in ms (60000 for a TikTok). The linter warns past it, naming the longest scenes.",
    ),
    captionStyle: oneOf(CAPTION_STYLES, "The overlay caption painting for every scene."),
    embedCaptions: boolean(
      "Whether the 4:3 canvas overlays captions; unset follows the voiceover.",
    ),
    view: oneOf(PLAYER_VIEWS, "The view the player opens in; unset opens in TikTok view."),
    cover: string("The home-page card image, by asset key."),
    notes: string("Showcase-level authoring notes; shown on the script page, never rendered."),
    soundtrack: object(
      "soundtrack",
      "The audio track.",
      {
        src: string("The track, by asset key."),
        volume: number("0 to 1.", { minimum: 0, maximum: 1 }),
        sync: boolean("true for a voiceover locked to the timeline; unset for a music bed."),
      },
      ["src"],
    ),
    source: object(
      "source",
      "The master recording a recorded pitch is cut from (the build reads it).",
      {
        video: string("The recording, by asset key, file name, or a path to another showcase's."),
        audio: string("A separate sound file; defaults to the video's own track."),
        speed: number("Playback speed, 0.5 to 2.", { minimum: 0.5, maximum: 2 }),
        tonemap: oneOf(TONEMAPS, "hlg maps an iPhone HDR recording to SDR."),
        voiceover: string("The built voiceover's asset key (default <showcase>-voiceover)."),
        clipPrefix: string("What built clips are named after (default clip-)."),
        pad: number("Seconds of trailing silence after the last take."),
        fade: number("Seconds the tail fades out over."),
        edgeFade: number("Seconds each clip's picture fades at its cut."),
        quality: number("The clips' encoding quality (x264 crf)."),
        fps: number("The clips' frame rate."),
        loudness: object("loudness", "Loudness targets, in LUFS.", {
          segment: number(),
          track: number(),
          ceiling: number(),
        }),
      },
    ),
    voiceover: object("voiceover", "A synthesized voice that reads the captions (AWS Polly).", {
      voice: string("The Polly voice (default Matthew)."),
      engine: oneOf(VOICEOVER_ENGINES),
      profile: string(
        "The AWS profile, when not the library's aws_profile in showcase_settings.yaml.",
      ),
      region: string("The AWS region, when not the library's aws_region or the profile's own."),
      track: string("The track's asset key (default voiceover)."),
      leadMs: number("Silence before each caption's words."),
      tailMs: number("Silence after."),
      holdMs: number("Extra hold on the last caption."),
      scenes: {
        type: "array",
        items: { type: "string" },
        description:
          "The scenes the voice reads, by id; the others keep their own timing and are silence " +
          "on the track. Unset: every scene.",
      },
    }),
    watermark: WATERMARK,
    tiktok: TIKTOK_FIT,
    theme: {
      type: "object",
      title: "theme overrides",
      description:
        "Quick style overrides by CSS variable name (no leading --), on top of theme.yaml. The names are theme.yaml's own variables (theme-rules.mjs).",
      additionalProperties: false,
      properties: Object.fromEntries(THEME_VARS.map((name) => [name, { type: "string" }])),
    },
  },
  ["title"],
);

const publishFields = (fields) =>
  Object.fromEntries(
    fields.map((name) => [
      name,
      name === "hashtags"
        ? {
            anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }],
            description: "Hashtags, without the #.",
          }
        : string(
            name === "title" ? "The video's title (YouTube)." : "The text the post goes out with.",
          ),
    ]),
  );

const PUBLISH = object(
  "publish",
  "The text a post goes out with: a default, then one block per destination.",
  {
    ...publishFields(PUBLISH_FIELDS),
    ...Object.fromEntries(
      Object.entries(DESTINATIONS).map(([id, destination]) => [
        id,
        object(
          `publish.${id}`,
          `${destination.label}'s own text.`,
          publishFields(destination.fields),
        ),
      ]),
    ),
  },
);

/** The whole document. */
export const SHOWCASE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "showcase.yaml",
  description:
    "A showcase: its meta, its scenes in order, and the text it is posted with. Written by the studio as .studio/showcase.schema.json; the guide (GUIDE.md) says how the fields are used.",
  type: "object",
  properties: {
    meta: META,
    scenes: { type: "array", items: SCENE, description: "The slides, in order." },
    publish: PUBLISH,
  },
  required: ["meta", "scenes"],
  additionalProperties: false,
};

/* ---------- the check ---------- */

const typeOf = (value) =>
  value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value === "number"
        ? Number.isInteger(value)
          ? "integer"
          : "number"
        : typeof value;

const matchesType = (schema, value) => {
  if (!schema.type) return true;
  const actual = typeOf(value);
  return schema.type === actual || (schema.type === "number" && actual === "integer");
};

const describeValue = (value) => {
  const kind = typeOf(value);
  if (kind === "string") return `"${value.length > 40 ? value.slice(0, 37) + "…" : value}"`;
  if (kind === "object") return "a map";
  if (kind === "array") return "a list";
  return String(value);
};

const wantType = (schema) =>
  schema.enum
    ? `one of ${schema.enum.join(", ")}`
    : schema.type === "object"
      ? "a map"
      : schema.type === "array"
        ? "a list"
        : schema.type === "string" && schema.pattern === PERCENT_PATTERN
          ? 'a percentage like "14%"'
          : schema.type === "number" || schema.type === "integer"
            ? "a number"
            : schema.type === "boolean"
              ? "true or false"
              : schema.type === "string"
                ? "text"
                : "something else";

const joinPath = (path) =>
  path.reduce(
    (text, part) =>
      typeof part === "number" ? `${text}[${part}]` : text ? `${text}.${part}` : part,
    "",
  );

/** Edit distance, for "did you mean". */
function distance(a, b) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[a.length][b.length];
}

/** Every object in the schema that has a property named `key`, as the
 *  path to it in schema terms ("scenes[].take"). */
function homesOf(schema, key, path = [], found = []) {
  if (!schema || typeof schema !== "object") return found;
  if (schema.properties) {
    const home = spellPath(joinPath(path));
    if (key in schema.properties && !found.includes(home)) found.push(home);
    for (const [name, child] of Object.entries(schema.properties)) {
      homesOf(child, key, [...path, name], found);
    }
  }
  if (schema.items) homesOf(schema.items, key, [...path, "[]"], found);
  for (const branch of schema.anyOf ?? []) homesOf(branch, key, path, found);
  return found;
}

const spellPath = (text) => text.replace(/\.\[\]/g, "[]");

/** What to say about an unknown field: a typo of a field here, a field
 *  that belongs somewhere else, or just the fields there are. */
function unknownFieldMessage(schema, key, path, root) {
  const where = path.length > 0 ? joinPath(path) : "the document";
  const name = schema.title ?? where;
  const known = Object.keys(schema.properties ?? {});
  const typo = known.find(
    (candidate) =>
      candidate !== key && distance(candidate, key) <= Math.min(2, Math.floor(key.length / 3)),
  );
  if (typo) return `${where}: "${key}" isn't a ${name} field — did you mean "${typo}"?`;
  const homes = homesOf(root, key);
  if (homes.length > 0) {
    /* The nearest home: the one sharing the most of this field's path,
     * the shorter (the ancestor) when two share the same. */
    const under = spellPath(joinPath(path).replace(/\[\d+\]/g, "[]")).split(".");
    const shared = (home) => {
      const parts = home.split(".");
      let n = 0;
      while (n < parts.length && n < under.length && parts[n] === under[n]) n++;
      return n;
    };
    const closest = homes.reduce((best, home) =>
      shared(home) > shared(best) || (shared(home) === shared(best) && home.length < best.length)
        ? home
        : best,
    );
    return `${where}: "${key}" isn't a ${name} field — it belongs in ${closest} (${closest}.${key})`;
  }
  return `${where}: "${key}" isn't a ${name} field — the fields are ${known.join(", ")}`;
}

/** Checks `value` against `schema`, adding problems. anyOf keeps the
 *  branch with the fewest problems, so a take that is nearly a span is
 *  judged as a span. */
function check(schema, value, path, problems, root) {
  if (!schema || typeof schema !== "object") return;
  if (schema.anyOf) {
    const here = joinPath(path);
    const results = schema.anyOf.map((branch) => {
      const found = [];
      check(branch, value, path, found, root);
      return found;
    });
    if (results.some((found) => found.length === 0)) return;
    /* Nothing deeper than the field itself is wrong in any branch: the
     * value simply isn't one of the things the field takes, so say them
     * all rather than one branch's guess. */
    const takes = [...new Set(schema.anyOf.map(wantType))].join(" or ");
    if (results.every((found) => found.every((problem) => problem.path === here))) {
      const shapeFits = results.some((found) => found.every((problem) => problem.kind !== "type"));
      problems.push({
        kind: shapeFits ? "value" : "type",
        path: here,
        message: `${here}: ${describeValue(value)} isn't ${takes}`,
      });
      return;
    }
    /* Else the branch of the value's own shape with the fewest problems:
     * a take that is nearly a span is judged as a span. */
    const fitting = results.filter(
      (found) => !found.some((problem) => problem.kind === "type" && problem.path === here),
    );
    const best = fitting.reduce((a, b) => (b.length < a.length ? b : a));
    problems.push(...best);
    return;
  }
  const here = joinPath(path);
  if (!matchesType(schema, value)) {
    problems.push({
      kind: "type",
      path: here,
      message: `${here}: ${describeValue(value)} isn't ${wantType(schema)}`,
    });
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    problems.push({
      kind: "value",
      path: here,
      message: `${here}: ${describeValue(value)} isn't ${wantType(schema)}`,
    });
    return;
  }
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
    problems.push({
      kind: "value",
      path: here,
      message: `${here}: ${describeValue(value)} isn't ${wantType(schema)}`,
    });
    return;
  }
  if (typeof value === "number") {
    if (
      (schema.minimum != null && value < schema.minimum) ||
      (schema.maximum != null && value > schema.maximum)
    ) {
      problems.push({
        kind: "value",
        path: here,
        message: `${here}: ${value} is outside ${schema.minimum ?? "…"} to ${schema.maximum ?? "…"}`,
      });
      return;
    }
  }
  if (schema.type === "array" && schema.items) {
    value.forEach((item, i) => check(schema.items, item, [...path, i], problems, root));
    return;
  }
  if (schema.type === "object") {
    for (const name of schema.required ?? []) {
      if (!(name in value)) {
        problems.push({
          kind: "missing",
          path: here ? `${here}.${name}` : name,
          message: `${here || "the document"}: needs ${name}`,
        });
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties?.[key];
      if (childSchema) {
        check(childSchema, child, [...path, key], problems, root);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        check(schema.additionalProperties, child, [...path, key], problems, root);
      } else if (schema.additionalProperties === false) {
        problems.push({
          kind: "unknown",
          path: here ? `${here}.${key}` : key,
          message: unknownFieldMessage(schema, key, path, root),
        });
      }
    }
  }
}

/** Everything in a parsed showcase.yaml that doesn't fit the schema:
 *  `{kind, path, message}` each, where kind is "unknown" (a field that
 *  isn't one here), "missing" (a required field), "type" (the wrong
 *  kind of value) or "value" (a value outside the field's choices or
 *  range). `sceneIndex` is set on problems inside a scene. Never
 *  throws; a document that isn't a map is one problem. */
export function checkShowcase(doc) {
  const problems = [];
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return [
      { kind: "type", path: "", message: "showcase.yaml must be a map with meta and scenes" },
    ];
  }
  check(SHOWCASE_SCHEMA, doc, [], problems, SHOWCASE_SCHEMA);
  return problems.map((problem) => {
    const scene = /^scenes\[(\d+)\]/.exec(problem.path);
    return scene ? { ...problem, sceneIndex: Number(scene[1]) } : problem;
  });
}
