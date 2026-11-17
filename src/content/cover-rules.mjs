/* A showcase's cover: the still image a platform shows before the video
 * plays (TikTok's and Instagram's profile grids, a Short's thumbnail).
 * Plain ESM with no imports, like publish-rules.mjs, so the page, the
 * studio's edit path (server/edit-cover.mjs) and the tools read one copy.
 * Types live in cover-rules.d.mts.
 *
 * The cover lives in its own file, <id>/cover.yaml, beside showcase.yaml
 * and theme.yaml. No file, no cover: the platform picks a frame of the
 * video. The file holds a default for every destination, and overrides
 * for each one:
 *
 *   picture: cover-frame          # asset key
 *   focus: top                    # which part of the picture the crop keeps
 *   layout: fade                  # fade | band | split
 *   fade: strong                  # light | medium | strong (fade layout)
 *   headline: Mirror your iPhone
 *   textPosition: bottom          # top | middle | bottom
 *   textSize: l                   # s | m | l
 *   graphics:                     # TSX graphics from graphics/, drawn finished
 *     - { graphic: arrow, at: bottom-right, size: 30 }
 *   instagram:                    # changes just these fields for Instagram
 *     headline: Mirror your iPhone. Link in bio.
 *
 * Each destination's block stands on its own: it inherits from the
 * default only, never from another destination. The video is never part
 * of a cover — a cover is a still image, drawn by CoverView and saved as
 * a PNG when one is needed. */

/** Where a cover goes. All three are 9:16; the 16:9 YouTube thumbnail
 *  comes later. */
export const COVER_DESTINATIONS = {
  tiktok: { label: "TikTok" },
  instagram: { label: "Instagram" },
  youtube: { label: "YouTube Shorts" },
};

/** The cover's size, in pixels. */
export const COVER_SIZE = { width: 1080, height: 1920 };

/** The middle 3:4 of the frame is what TikTok's and Instagram's profile
 *  grids show; the rest is cut off there. In percent of the frame's
 *  height, off the top and off the bottom. Text and graphics are placed
 *  inside it. */
export const COVER_GRID_CROP = 12.5;

/** The fixed set of cover layouts, drawn by CoverView:
 *    fade      the picture fills the frame, large text over a dark fade
 *    band      the picture fills the frame, the text in a band of the
 *              theme's color
 *    split     the text takes the room it needs, the picture is shown
 *              whole in the rest — for an app screenshot, which
 *              shouldn't be cropped to fill */
export const COVER_LAYOUTS = ["fade", "band", "split"];

/** How dark the fade layout's fade is behind the text: light for a dark
 *  picture, strong for a bright one. */
export const COVER_FADES = ["light", "medium", "strong"];

export const COVER_TEXT_POSITIONS = ["top", "middle", "bottom"];
export const COVER_TEXT_SIZES = ["s", "m", "l"];
/** Which part of the picture a crop keeps: top, center or bottom for a
 *  picture taller than 9:16, left, center or right for a wider one. A
 *  9:16 picture, or one the split layout shows whole, isn't cropped. */
export const COVER_FOCUS = ["top", "center", "bottom", "left", "right"];

/** Where a graphic sits, inside the grid crop. */
export const COVER_ANCHORS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
];

/** A graphic's width, in percent of the frame's width. */
export const GRAPHIC_SIZE = { min: 5, max: 100, default: 30 };

/** What a field is, and what the edit tool and the loader accept. */
export const COVER_FIELDS = {
  picture: { type: "string", description: "The picture, by asset key." },
  focus: {
    type: "enum",
    values: COVER_FOCUS,
    description:
      "Which part of the picture the crop keeps (default center): top, center or bottom for a picture taller than 9:16; left, center or right for a wider one.",
  },
  layout: {
    type: "enum",
    values: COVER_LAYOUTS,
    description: "fade, band or split (default fade).",
  },
  fade: {
    type: "enum",
    values: COVER_FADES,
    description:
      "How dark the fade behind the text is, in the fade layout: light, medium or strong (default medium). Light for a dark picture, strong for a bright one.",
  },
  headline: { type: "string", description: "The large text." },
  textPosition: {
    type: "enum",
    values: COVER_TEXT_POSITIONS,
    description: "Where the text sits: top, middle or bottom (default bottom; split: top).",
  },
  textSize: {
    type: "enum",
    values: COVER_TEXT_SIZES,
    description: "s, m or l (default m).",
  },
  graphics: {
    type: "graphics",
    description: `TSX graphics from graphics/, each {graphic, at, size}: at is one of ${COVER_ANCHORS.join(", ")}; size is its width in percent of the frame (default ${GRAPHIC_SIZE.default}).`,
  },
};

export const COVER_FIELD_NAMES = Object.keys(COVER_FIELDS);

const DEFAULTS = { focus: "center", layout: "fade", fade: "medium", textSize: "m" };

/** The problem with one field's value, or null when it's fine. */
export function coverValueProblem(name, value) {
  const field = COVER_FIELDS[name];
  if (!field) {
    return `cover has no field "${String(name)}" — fields: ${COVER_FIELD_NAMES.join(", ")}`;
  }
  if (field.type === "string") {
    return typeof value === "string" ? null : `${name} must be text`;
  }
  if (field.type === "enum") {
    return field.values.includes(value)
      ? null
      : `${name} must be one of ${field.values.join(", ")} (not "${String(value)}")`;
  }
  if (!Array.isArray(value)) return "graphics must be a list of {graphic, at, size}";
  for (const [i, item] of value.entries()) {
    const where = `graphics[${i}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return `${where} must be {graphic, at, size}`;
    }
    const extra = Object.keys(item).find((key) => !["graphic", "at", "size"].includes(key));
    if (extra) return `${where} has no field "${extra}" — fields: graphic, at, size`;
    if (typeof item.graphic !== "string" || !item.graphic) {
      return `${where}.graphic must name a graphic in graphics/`;
    }
    if (item.at !== undefined && !COVER_ANCHORS.includes(item.at)) {
      return `${where}.at must be one of ${COVER_ANCHORS.join(", ")} (not "${String(item.at)}")`;
    }
    if (
      item.size !== undefined &&
      (typeof item.size !== "number" ||
        item.size < GRAPHIC_SIZE.min ||
        item.size > GRAPHIC_SIZE.max)
    ) {
      return `${where}.size must be a number from ${GRAPHIC_SIZE.min} to ${GRAPHIC_SIZE.max} (percent of the frame's width)`;
    }
  }
  return null;
}

/** Every problem in a cover.yaml document, as plain sentences. A field
 *  with a problem is left out when the cover is drawn; the rest still
 *  draws. */
export function checkCover(doc) {
  if (doc == null) return [];
  if (typeof doc !== "object" || Array.isArray(doc)) return ["cover.yaml must be a map of fields"];
  const problems = [];
  const checkBlock = (block, where) => {
    for (const [name, value] of Object.entries(block)) {
      if (where === "" && name in COVER_DESTINATIONS) continue;
      const problem = coverValueProblem(name, value);
      if (problem) problems.push(where ? `${where}: ${problem}` : problem);
    }
  };
  checkBlock(doc, "");
  for (const destination of Object.keys(COVER_DESTINATIONS)) {
    const block = doc[destination];
    if (block === undefined || block === null) continue;
    if (typeof block !== "object" || Array.isArray(block)) {
      problems.push(`${destination} must be a map of the fields it changes`);
      continue;
    }
    checkBlock(block, destination);
  }
  return problems;
}

/** One destination's cover: its own fields over the default ones, each
 *  field with a problem left out, the defaults filled in. `overridden`
 *  names the fields the destination sets itself. */
export function resolveCover(doc, destination) {
  const base = doc && typeof doc === "object" && !Array.isArray(doc) ? doc : {};
  const own =
    destination && base[destination] && typeof base[destination] === "object"
      ? base[destination]
      : {};
  const cover = { ...DEFAULTS, graphics: [] };
  const overridden = [];
  for (const name of COVER_FIELD_NAMES) {
    const fromOwn = Object.hasOwn(own, name) && coverValueProblem(name, own[name]) === null;
    const value = fromOwn ? own[name] : base[name];
    if (value === undefined || coverValueProblem(name, value) !== null) continue;
    cover[name] = value;
    if (fromOwn) overridden.push(name);
  }
  cover.textPosition ??= cover.layout === "split" ? "top" : "bottom";
  cover.graphics = cover.graphics.map((item) => ({
    graphic: item.graphic,
    at: item.at ?? "center",
    size: item.size ?? GRAPHIC_SIZE.default,
  }));
  return { ...cover, overridden };
}

/** Checks one edit — `{destination?, name, value}` — before it's written,
 *  and throws with the reason. A null or "" value removes the field. */
export function checkCoverEdit({ destination, name, value } = {}) {
  if (destination != null && !(destination in COVER_DESTINATIONS)) {
    throw new Error(
      `cover has no destination "${String(destination)}" — destinations: ${Object.keys(COVER_DESTINATIONS).join(", ")}`,
    );
  }
  if (!(name in COVER_FIELDS)) {
    throw new Error(
      `cover has no field "${String(name)}" — fields: ${COVER_FIELD_NAMES.join(", ")}`,
    );
  }
  if (value === null || value === "") return;
  const problem = coverValueProblem(name, value);
  if (problem) throw new Error(problem);
}

/* cover.yaml's shape as a JSON Schema, for a reader: the studio writes
 *  it into every library as .studio/cover.schema.json. */
function buildSchema() {
  const property = (field) => {
    if (field.type === "string") return { type: "string", description: field.description };
    if (field.type === "enum") {
      return { type: "string", enum: field.values, description: field.description };
    }
    return {
      type: "array",
      description: field.description,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["graphic"],
        properties: {
          graphic: { type: "string", description: "The graphic, by key." },
          at: { type: "string", enum: COVER_ANCHORS },
          size: { type: "number", minimum: GRAPHIC_SIZE.min, maximum: GRAPHIC_SIZE.max },
        },
      },
    };
  };
  const fields = Object.fromEntries(
    Object.entries(COVER_FIELDS).map(([name, field]) => [name, property(field)]),
  );
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "cover.yaml",
    description:
      "A showcase's cover image: a default for every destination, and overrides for each one.",
    type: "object",
    additionalProperties: false,
    properties: {
      ...fields,
      ...Object.fromEntries(
        Object.entries(COVER_DESTINATIONS).map(([id, { label }]) => [
          id,
          {
            type: "object",
            additionalProperties: false,
            description: `${label}'s own values for the fields it changes; the rest come from the default.`,
            properties: fields,
          },
        ]),
      ),
    },
  };
}

/** cover.yaml's shape as a JSON Schema (see buildSchema). */
export const COVER_SCHEMA = buildSchema();
