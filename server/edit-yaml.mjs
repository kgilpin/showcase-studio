/* Whitelisted, comment-preserving field edits on a showcase.yaml — the
 * write path behind in-app editing (titles, captions, scene media).
 *
 * The YAML is never parsed-and-redumped: parseDocument keeps every
 * comment, blank line, and quote style, and setIn touches only the one
 * field being edited. Showcase YAML comments are load-bearing (edit
 * lists, timing notes), so anything that rewrites the whole file would
 * destroy real work.
 *
 * Only these fields are editable — this is a deliberate whitelist, not a
 * generic YAML patch API:
 *
 *   { field: "title",       value }                 set (empty deletes)
 *   { field: "caption",     captionIndex, value }   captions[i].text
 *   { field: "caption.insert", captionIndex, caption }
 *                                                   insert the caption
 *                                                   object at the index
 *   { field: "caption.delete", captionIndex }       remove captions[i]
 *   { field: "scene.insert", index, scene }         insert the scene
 *                                                   object at the index
 *                                                   (no sceneId; the new
 *                                                   scene's id must be
 *                                                   unique)
 *   { field: "scene.delete" }                       remove the scene
 *   { field: "media.asset", value, mediaKind? }     media.asset
 *                                                   (+ media.kind when the
 *                                                   new asset is a video
 *                                                   and the old an image,
 *                                                   or vice versa)
 *   { field: "media.tiktok", value }                the scene's own TikTok
 *                                                   fit (media.tiktok);
 *                                                   null removes it
 *   { field: "media.set",   media }                 replace the whole
 *                                                   media mapping (the
 *                                                   graphic ↔ asset swap)
 *   { field: "meta.captionStyle", value }           showcase-wide caption
 *                                                   painting, chip|karaoke
 *                                                   (empty deletes; no
 *                                                   sceneId — it's meta)
 *   { field: "scene.set",   name, value }           one whitelisted scene
 *                                                   field (SCENE_FIELDS);
 *                                                   null/"" removes an
 *                                                   optional one. media
 *                                                   sets the media keys
 *                                                   given and keeps the
 *                                                   rest (null removes
 *                                                   one). A new
 *                                                   durationMs re-scales
 *                                                   the captions' own
 *                                                   durationMs with it
 *                                                   (scaleCaptions: false
 *                                                   leaves them); speed is
 *                                                   written to media.speed
 *   { field: "caption.set", captionIndex, name, value }
 *                                                   captions[i].text /
 *                                                   durationMs / position / id
 *   { field: "meta.set",    name, value }           one whitelisted meta
 *                                                   field (META_FIELDS)
 *   { field: "scene.move",  index }                 move the scene to the
 *                                                   index (no sceneId in
 *                                                   the target; the scene
 *                                                   is the addressed one)
 *   { field: "publish.set", destination?, name, value }
 *                                                   the text a showcase is
 *                                                   posted with: the
 *                                                   top-level publish:
 *                                                   block's default, or one
 *                                                   destination's override
 *                                                   (src/content/
 *                                                   publish-rules.mjs); null
 *                                                   or "" removes it
 *
 * The page uses the named fields. scene.set, caption.set, meta.set and
 * scene.move are for the MCP edit tool (edit_showcase). A recorded
 * pitch's `take` is a scene.set field, checked by takeProblem in
 * build-plan.mjs. edit-yaml.test.mjs checks that the whitelists and the
 * schema (src/content/showcase-schema.mjs) hold the same fields, so
 * every field of showcase.yaml can be edited here. A field with no rule
 * file of its own is checked against its schema entry (kind "schema").
 */
import { isDeepStrictEqual } from "node:util";
import { isCollection, isMap, isScalar, isSeq, Scalar } from "yaml";
import { editedText, keepLineSpacing, parseEditable } from "./yaml-text.mjs";
import {
  inRange,
  WATERMARK_FIELDS,
  WATERMARK_OPACITY,
  WATERMARK_POSITIONS,
  WATERMARK_SCALE,
  WATERMARK_INSET,
  WATERMARK_SHADE,
  watermarkInset,
  watermarkShade,
} from "../src/content/watermark-rules.mjs";
import {
  CAPTION_POSITION_HELP,
  isCaptionPosition,
} from "../src/content/caption-position-rules.mjs";
import { CAPTION_ID_HELP, isCaptionId } from "../src/content/caption-starts-rules.mjs";
import { TIKTOK_FIELDS, tiktokFieldProblem } from "../src/content/tiktok-fit-rules.mjs";
import { checkPublishEdit } from "../src/content/publish-rules.mjs";
import { PLAYER_VIEWS } from "../src/lib/export-kinds.mjs";
import { videoSpeedProblem } from "../src/content/timing.mjs";
import { takeProblem } from "./build-plan.mjs";
import { checkField, fieldSchema } from "../src/content/showcase-schema.mjs";

const CAPTION_STYLES = ["chip", "karaoke", "reveal"];
/* The brand mark sits in a corner — there is no banner position, and no
 * affordance for turning the App Store badge into a watermark. See
 * src/content/watermark.ts for why. */

/* The field whitelists behind scene.set / meta.set / caption.set: how a
 * value validates, and whether an empty value removes the field. `map`
 * lists the keys an object value may carry (those marked true required). */
const SCENE_FIELDS = {
  id: { kind: "string" },
  theme: { kind: "string" },
  title: { kind: "string", removable: true },
  eyebrow: { kind: "string", removable: true },
  support: { kind: "string", removable: true },
  ctaNote: { kind: "string", removable: true },
  captionStyle: { kind: "enum", values: CAPTION_STYLES, removable: true },
  transition: { kind: "string", removable: true },
  durationMs: { kind: "duration", removable: true },
  /* The longest this scene should run — overrides meta.sceneMaxMs (the
   * LENGTH model in src/content/timing.mjs). */
  maxMs: { kind: "duration", removable: true },
  /* A video clip's playing rate — written to media.speed, on video media
   * only. */
  speed: { kind: "speed", path: ["media", "speed"], removable: true },
  export: { kind: "boolean", removable: true },
  cta: { kind: "map", map: { label: true, url: true, kind: false }, removable: true },
  note: { kind: "string", removable: true },
  /* The showcase's brand mark, per scene: false opts this slide out,
   * true forces it on, a map overrides a field or two for this slide. */
  watermark: { kind: "watermark", scene: true, removable: true },
  /* How this scene's picture goes into TikTok's 9:16 frame — written to
   * media.tiktok (src/content/tiktok-fit.ts). */
  tiktok: { kind: "tiktok", path: ["media", "tiktok"], removable: true },
  /* What the scene shows. scene.set media sets the keys it is given and
   * keeps the others, so a one-key change (motion, fit) leaves the rest
   * and its comments alone; media.set replaces the whole mapping. */
  media: { kind: "media", removable: true },
  /* Fields the loader still reads but no longer uses: they can only be
   * removed. */
  titleDurationMs: { kind: "obsolete", removable: true },
  captionsIn: { kind: "obsolete", removable: true },
  /* The span of the master recording this scene owns, on a recorded
   * pitch (server/build-plan.mjs): {from, to}, a list of them, {silence},
   * or {audio, video}, plus clip: true|false. */
  take: { kind: "take", removable: true },
};

const META_FIELDS = {
  title: { kind: "string" },
  description: { kind: "string" },
  loop: { kind: "boolean", removable: true },
  pace: { kind: "number", removable: true },
  /* The length limits (the LENGTH model in src/content/timing.mjs): the
   * longest any scene should run, and what the whole video should add
   * up to. The linter warns past either; neither changes the timing. */
  sceneMaxMs: { kind: "duration", removable: true },
  targetMs: { kind: "duration", removable: true },
  captionStyle: { kind: "enum", values: CAPTION_STYLES, removable: true },
  /* Overlay captions on the 4:3 embed canvas; unset follows the voiceover
   * (src/content/embed-captions.ts). */
  embedCaptions: { kind: "boolean", removable: true },
  /* The view the player opens this showcase in (tiktok, screens, embed);
   * unset opens in TikTok view. The player's pin button writes it. */
  view: { kind: "enum", values: PLAYER_VIEWS, removable: true },
  cover: { kind: "string", removable: true },
  soundtrack: { kind: "map", map: { src: true, volume: false, sync: false }, removable: true },
  notes: { kind: "string", removable: true },
  /* A synthesized voiceover's settings (server/voiceover.mjs): the Polly
   * voice and engine, how to reach AWS, the track's asset key, and how
   * words are said. Merged into the map that is there (mergeMap), so the
   * say list keeps its comments. A bad say entry isn't refused here:
   * validate warns about it, and it mustn't block an edit beside it. */
  voiceover: {
    kind: "map",
    merge: true,
    map: {
      voice: false,
      engine: false,
      profile: false,
      region: false,
      track: false,
      leadMs: false,
      tailMs: false,
      holdMs: false,
      scenes: false,
      say: false,
    },
    removable: true,
  },
  /* The persistent brand mark ("bug") drawn in a corner of every slide
   * (src/content/watermark.ts). */
  watermark: { kind: "watermark", removable: true },
  /* How every scene's picture goes into TikTok's 9:16 frame
   * (src/content/tiktok-fit.ts). */
  tiktok: { kind: "tiktok", removable: true },
  /* The video template the showcase started from (create_showcase
   * writes it). */
  template: { kind: "string", removable: true },
  /* The master recording a recorded pitch is cut from (build-plan.mjs). */
  source: { kind: "schema", removable: true },
  /* Flat style overrides on top of theme.yaml (theme-rules.mjs names). */
  theme: { kind: "schema", removable: true },
};

const CAPTION_FIELDS = {
  text: { kind: "string" },
  durationMs: { kind: "duration", removable: true },
  position: { kind: "captionPosition", removable: true },
  id: { kind: "captionId", removable: true },
};

/** The whitelists, for the test that holds them to the schema
 *  (src/content/showcase-schema.mjs): every editable field is a field
 *  there, so the two can't drift. */
export const EDITABLE_FIELDS = { scene: SCENE_FIELDS, meta: META_FIELDS, caption: CAPTION_FIELDS };

/** Validates one whitelisted-field value. Returns `{ remove: true }` for
 *  an empty value on a removable field, else `{ value }` ready for
 *  createNode. Throws with a plain message otherwise. */
function checkFieldValue(fields, where, name, value) {
  const spec = fields[name];
  if (!spec) {
    throw new Error(
      `"${name}" is not an editable ${where} field — one of: ${Object.keys(fields).join(", ")}`,
    );
  }
  if (value == null || value === "" || (typeof value === "string" && !value.trim())) {
    if (!spec.removable) throw new Error(`${where}.${name} needs a value`);
    return { remove: true };
  }
  const label = `${where}.${name}`;
  switch (spec.kind) {
    case "string":
      if (typeof value !== "string") throw new Error(`${label} must be text`);
      return { value: value.trim() };
    case "enum":
      if (!spec.values.includes(value)) {
        throw new Error(`${label} must be one of: ${spec.values.join(", ")}`);
      }
      return { value };
    case "captionPosition":
      if (!isCaptionPosition(value)) throw new Error(`${label} must be ${CAPTION_POSITION_HELP}`);
      return { value: value.trim() };
    case "captionId":
      if (!isCaptionId(value)) throw new Error(`${label} must be ${CAPTION_ID_HELP}`);
      return { value };
    case "take": {
      const problem = takeProblem(value);
      if (problem) throw new Error(`${label}: ${problem.replace(/^scene "scene" take:? ?/, "")}`);
      if (!Array.isArray(value) && value.clip != null && typeof value.clip !== "boolean") {
        throw new Error(`${label}.clip must be true or false`);
      }
      return { value };
    }
    case "duration":
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a whole number of milliseconds`);
      }
      return { value };
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number`);
      }
      return { value };
    case "speed": {
      const problem = videoSpeedProblem(value);
      if (problem) throw new Error(`${label} ${problem}`);
      return { value };
    }
    case "boolean":
      if (typeof value !== "boolean") throw new Error(`${label} must be true or false`);
      return { value };
    case "watermark": {
      /* A scene's watermark may also be a plain false (opt this slide
       * out) or true (force the showcase's mark back on). */
      if (spec.scene && typeof value === "boolean") return { value };
      const shape = spec.scene
        ? `false, true, or a map of ${WATERMARK_FIELDS.join(", ")}`
        : `a map of ${WATERMARK_FIELDS.join(", ")}`;
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be ${shape}`);
      }
      for (const key of Object.keys(value)) {
        if (!WATERMARK_FIELDS.includes(key)) {
          throw new Error(
            `${label}.${key} is not a field — ${label} takes: ${WATERMARK_FIELDS.join(", ")}`,
          );
        }
      }
      /* On a scene, an empty asset or text drops the showcase's image or
       * wordmark for that slide. */
      for (const key of ["asset", "text"]) {
        if (value[key] == null) continue;
        if (typeof value[key] !== "string" || (!spec.scene && !value[key].trim())) {
          throw new Error(`${label}.${key} must be text`);
        }
      }
      if (value.position != null && !WATERMARK_POSITIONS.includes(value.position)) {
        throw new Error(`${label}.position must be a corner: ${WATERMARK_POSITIONS.join(", ")}`);
      }
      if (value.inset != null && watermarkInset(value.inset) == null) {
        throw new Error(
          `${label}.inset must be a height from ${WATERMARK_INSET.min}% to ${WATERMARK_INSET.max}% ` +
            `(e.g. "13%": the mark that far from the top or bottom edge)`,
        );
      }
      if (value.shade != null && watermarkShade(value.shade) == null) {
        throw new Error(
          `${label}.shade must be true, false, or an opacity between ` +
            `${WATERMARK_SHADE.min} and ${WATERMARK_SHADE.max}`,
        );
      }
      for (const [key, range] of [
        ["opacity", WATERMARK_OPACITY],
        ["scale", WATERMARK_SCALE],
      ]) {
        if (value[key] != null && !inRange(value[key], range)) {
          throw new Error(`${label}.${key} must be a number between ${range.min} and ${range.max}`);
        }
      }
      /* A mark with nothing to draw would silently do nothing. The
       * scene-level form may omit both — it is merged over meta's. */
      if (!spec.scene && !value.asset && !value.text) {
        throw new Error(`${label} needs an asset, a text wordmark, or both`);
      }
      /* null fields would be written as `key: null`, which the loader
       * ignores — leave them out. */
      const set = Object.fromEntries(Object.entries(value).filter(([, v]) => v != null));
      return { value: set, flow: true };
    }
    case "tiktok": {
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a map of ${TIKTOK_FIELDS.join(", ")}`);
      }
      for (const [key, field] of Object.entries(value)) {
        const problem = tiktokFieldProblem(label, key, field);
        if (problem) throw new Error(problem);
      }
      return { value, flow: true };
    }
    case "map": {
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a map of ${Object.keys(spec.map).join(", ")}`);
      }
      for (const key of Object.keys(value)) {
        if (!(key in spec.map)) {
          throw new Error(
            `${label}.${key} is not a field — ${label} takes: ${Object.keys(spec.map).join(", ")}`,
          );
        }
      }
      for (const [key, required] of Object.entries(spec.map)) {
        if (required && (typeof value[key] !== "string" || !value[key])) {
          throw new Error(`${label}.${key} is required`);
        }
      }
      return { value, flow: true };
    }
    case "schema": {
      /* Checked against the field's own schema entry: a recorded pitch's
       * source, meta.theme. */
      const path = where === "scene" ? ["scenes", 0, name] : [where, name];
      const problem = checkField(path, value)[0];
      if (problem) throw new Error(problem.message.replace(/^scenes\[0\]/, "scene"));
      return { value };
    }
    case "media": {
      if (typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${label} must be a map of ${mediaKeys().join(", ")}`);
      }
      const set = {};
      for (const [key, field] of Object.entries(value)) {
        if (field == null) {
          set[key] = null;
          continue;
        }
        /* speed and tiktok have rule files of their own. */
        if (key === "speed" || key === "tiktok") {
          set[key] = checkFieldValue(SCENE_FIELDS, where, key, field).value;
          continue;
        }
        const problem = checkField(["scenes", 0, "media", key], field)[0];
        if (problem) {
          throw new Error(
            problem.kind === "unknown"
              ? `${label}.${key} is not a field — ${label} takes: ${mediaKeys().join(", ")}`
              : problem.message.replace(/^scenes\[0\]/, "scene"),
          );
        }
        set[key] = field;
      }
      return { value: set };
    }
    case "obsolete":
      throw new Error(
        `${label} is obsolete (${spec.why ?? fieldSchema(where === "scene" ? ["scenes", 0, name] : [where, name])?.description ?? "no longer used"}) — pass null to remove it`,
      );
    /* v8 ignore next 2 -- every whitelist entry above names a kind */
    default:
      throw new Error(`${label} has no validator`);
  }
}

/** A whole scene or caption written by an insert: refused when it has a
 *  field the schema doesn't know or a value of the wrong type. A value
 *  outside a field's choices is left to validate, which warns about it
 *  the way it does for a hand-written file (some, like a legacy theme,
 *  still render). */
function refuseMisshapen(path, value, what) {
  const problem = checkField(path, value).find((p) => p.kind !== "value");
  if (!problem) return;
  const where = path.length > 2 ? "caption" : "scene";
  const message = problem.message.replace(/^scenes\[0\](\.captions\[0\])?/, where);
  throw new Error(`${what} doesn't fit showcase.yaml: ${message}`);
}

/** The keys a scene's media mapping takes. */
const mediaKeys = () => Object.keys(fieldSchema(["scenes", 0, "media"]).properties);

/** scene.set media: each key given is set (null removes it), the rest
 *  stay as written. The result must still say what kind of media it is,
 *  and a playing rate only means something on a video. */
function mergeMedia(doc, index, sceneId, set) {
  const at = ["scenes", index, "media"];
  const node = doc.getIn(at);
  if (node != null && !isMap(node)) throw new Error(`Scene "${sceneId}" media is not a mapping`);
  const was = isMap(node) ? node.toJSON() : {};
  const merged = { ...was };
  for (const [key, field] of Object.entries(set)) {
    if (field == null) delete merged[key];
    else merged[key] = field;
  }
  if (typeof merged.kind !== "string") {
    throw new Error(`Scene "${sceneId}" media needs a kind (${MEDIA_KINDS_HELP})`);
  }
  if (merged.speed != null && merged.kind !== "video") {
    throw new Error(
      `Scene "${sceneId}" shows a${merged.kind === "image" ? "n" : ""} ${merged.kind} — speed applies to a video`,
    );
  }
  if (!isMap(node)) {
    doc.setIn(at, doc.createNode(merged));
    return;
  }
  for (const [key, field] of Object.entries(set)) {
    if (field == null) {
      doc.deleteIn([...at, key]);
      continue;
    }
    const value = doc.createNode(field);
    if (key === "tiktok") value.flow = true;
    doc.setIn([...at, key], value);
  }
}

const MEDIA_KINDS_HELP = fieldSchema(["scenes", 0, "media", "kind"]).enum.join(", ");

/** setIn with removal-on-empty; object values keep the one-line flow
 *  style the authored files use (soundtrack: { src: ..., ... }). */
function setChecked(doc, basePath, checked) {
  if (checked.remove) {
    doc.deleteIn(basePath);
    return;
  }
  const node = doc.createNode(checked.value);
  if (checked.flow) node.flow = true;
  doc.setIn(basePath, node);
}

const isPlainMap = (value) => value != null && typeof value === "object" && !Array.isArray(value);

/** A new value inside a merged map: on one line, except a say list,
 *  which gets a line per word. */
function nodeInMap(doc, key, value) {
  const node = doc.createNode(value);
  if (!isCollection(node)) return node;
  if (key === "say" && isMap(node)) {
    for (const { value: entry } of node.items) if (isCollection(entry)) entry.flow = true;
  } else {
    node.flow = true;
  }
  return node;
}

/** Makes the map `node`, which reads as `current`, read as `value`,
 *  touching only the fields that differ: the others keep their comments,
 *  quotes and layout. */
function mergeMap(doc, node, current, value) {
  /* By the key's text: YAML reads `42:` as a number, the edit as "42". */
  const keyOf = (pair) => String(isScalar(pair.key) ? pair.key.value : pair.key);
  node.items = node.items.filter((pair) => Object.hasOwn(value, keyOf(pair)));
  for (const [key, next] of Object.entries(value)) {
    const pair = node.items.find((item) => keyOf(item) === key);
    const was = current[key];
    if (!pair) {
      node.items.push(doc.createPair(key, nodeInMap(doc, key, next)));
    } else if (isDeepStrictEqual(was, next)) {
      continue;
    } else if (isMap(pair.value) && isPlainMap(was) && isPlainMap(next)) {
      mergeMap(doc, pair.value, was, next);
    } else if (isScalar(pair.value) && was != null && typeof was === typeof next) {
      pair.value.value = next;
    } else {
      const made = nodeInMap(doc, key, next);
      made.comment = pair.value?.comment;
      made.commentBefore = pair.value?.commentBefore;
      pair.value = made;
    }
  }
}

/** The publish.set edit: one field of the top-level publish: block, the
 *  default (no destination) or one destination's override. The block is
 *  created right after meta the first time, and an override or block left
 *  empty is removed, so inheriting again leaves no trace. */
function setPublishField(text, { destination, name, value }) {
  const checked = checkPublishEdit({ destination, name, value });
  const doc = parseEditable(text);
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  const root = doc.contents;
  if (!isMap(root)) throw new Error("showcase.yaml is not a mapping");
  const block = doc.get("publish");
  if (block != null && !isMap(block)) throw new Error("publish: in showcase.yaml is not a mapping");
  const at = destination ? ["publish", destination] : ["publish"];
  const empty = (path) => {
    const node = doc.getIn(path);
    return isMap(node) && node.items.length === 0;
  };

  if (checked.remove) {
    if (!block) return text;
    doc.deleteIn([...at, name]);
    if (destination && empty(at)) doc.deleteIn(at);
    if (empty(["publish"])) doc.delete("publish");
    return editedText(doc);
  }
  if (!block) {
    const pair = doc.createPair("publish", doc.createNode({}));
    pair.key.spaceBefore = true;
    const metaAt = root.items.findIndex((item) => isScalar(item.key) && item.key.value === "meta");
    root.items.splice(metaAt < 0 ? 0 : metaAt + 1, 0, pair);
  }
  if (destination && doc.getIn(at) != null && !isMap(doc.getIn(at))) {
    throw new Error(`publish.${destination} in showcase.yaml is not a mapping`);
  }
  const node = doc.createNode(checked.value);
  /* Hashtags stay on one line; a caption with line breaks is written as
   * a block, the way an author would type it. */
  if (Array.isArray(checked.value)) node.flow = true;
  else if (checked.value.includes("\n")) node.type = Scalar.BLOCK_LITERAL;
  doc.setIn([...at, name], node);
  return editedText(doc);
}

/** scene.set durationMs on a scene whose captions carry their own
 *  durationMs: every pinned caption is scaled by the same ratio as the
 *  scene, so they still add up (issue #21 — the arithmetic an author had
 *  to do by hand after a clip got shorter). The old length is the
 *  scene's own pin, or, when the scene had none and every caption is
 *  pinned, their sum (which is what the scene ran for). Rounding drift
 *  lands on the last pinned caption, so the pinned total scales exactly;
 *  a scene with untimed captions leaves them to split the rest. */
function rescalePinnedCaptions(doc, index, newMs) {
  const sceneNode = doc.getIn(["scenes", index]);
  const captions = sceneNode.get("captions");
  if (!isSeq(captions)) return;
  const pinned = captions.items
    .map((item, i) => (isMap(item) && typeof item.get("durationMs") === "number" ? i : -1))
    .filter((i) => i >= 0);
  if (pinned.length === 0) return;
  const sum = pinned.reduce((n, i) => n + captions.items[i].get("durationMs"), 0);
  const own = sceneNode.get("durationMs");
  const oldMs =
    typeof own === "number" ? own : pinned.length === captions.items.length ? sum : undefined;
  if (!oldMs || oldMs <= 0 || oldMs === newMs) return;
  const ratio = newMs / oldMs;
  let scaled = 0;
  pinned.forEach((i, k) => {
    const was = captions.items[i].get("durationMs");
    const value = Math.max(
      1,
      k === pinned.length - 1 ? Math.round(sum * ratio) - scaled : Math.round(was * ratio),
    );
    scaled += value;
    doc.setIn(["scenes", index, "captions", i, "durationMs"], value);
  });
}

/** Applies one scene edit to showcase.yaml text and returns the new text.
 *  Throws with a plain message when the edit can't be applied. */
export function applySceneEdit(
  text,
  {
    sceneId,
    field,
    captionIndex,
    value,
    mediaKind,
    caption,
    index: insertIndex,
    scene,
    media,
    name,
    destination,
    scaleCaptions,
  } = {},
) {
  const needsValue = ["title", "caption", "media.asset", "meta.captionStyle"].includes(field);
  if (needsValue && typeof value !== "string") throw new Error("Missing value");

  /* The stage controls' TikTok fit edit is the whitelisted scene field
   * of the same name (scene.set name: tiktok, written to media.tiktok). */
  if (field === "media.tiktok") {
    return applySceneEdit(text, { sceneId, field: "scene.set", name: "tiktok", value });
  }

  /* Meta edits address the showcase, not a scene. */
  if (field === "meta.captionStyle") {
    if (value !== "" && !CAPTION_STYLES.includes(value)) {
      throw new Error(`captionStyle must be one of: ${CAPTION_STYLES.join(", ")}`);
    }
    const doc = parseEditable(text);
    if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
    if (!isMap(doc.get("meta"))) throw new Error("showcase.yaml has no meta section");
    if (value) doc.setIn(["meta", "captionStyle"], value);
    else doc.deleteIn(["meta", "captionStyle"]);
    return editedText(doc);
  }

  if (field === "meta.set") {
    const checked = checkFieldValue(META_FIELDS, "meta", name, value);
    const doc = parseEditable(text);
    if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
    if (!isMap(doc.get("meta"))) throw new Error("showcase.yaml has no meta section");
    const existing = doc.getIn(["meta", name]);
    if (META_FIELDS[name].merge && !checked.remove && isMap(existing)) {
      const current = doc.toJS().meta[name];
      if (isDeepStrictEqual(current, checked.value)) return text;
      mergeMap(doc, existing, current, checked.value);
      return keepLineSpacing(text, editedText(doc));
    }
    setChecked(doc, ["meta", name], checked);
    return editedText(doc);
  }

  if (field === "publish.set") return setPublishField(text, { destination, name, value });

  /* Scene insertion addresses a position, not a scene. */
  if (field === "scene.insert") {
    if (typeof scene?.id !== "string" || !scene.id) {
      throw new Error("The inserted scene needs a text id");
    }
    const doc = parseEditable(text);
    if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
    const scenes = doc.get("scenes");
    if (!isSeq(scenes)) throw new Error("showcase.yaml has no scenes list");
    if (scenes.items.some((item) => isMap(item) && item.get("id") === scene.id)) {
      throw new Error(`A scene with the id "${scene.id}" already exists`);
    }
    if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > scenes.items.length) {
      throw new Error(`Scene index ${insertIndex} is out of range`);
    }
    refuseMisshapen(["scenes", 0], scene, "The inserted scene");
    scenes.items.splice(insertIndex, 0, doc.createNode(scene));
    return editedText(doc);
  }

  if (sceneId != null && sceneId !== "" && typeof sceneId !== "string") {
    /* YAML read the id as a number or boolean (id: 2024, id: on) — the
     * scene renders fine but can't be addressed. Name the real problem. */
    throw new Error(
      `Scene id ${JSON.stringify(sceneId)} is not text in showcase.yaml — quote it (id: "${String(sceneId)}") to make the scene editable`,
    );
  }
  if (typeof sceneId !== "string" || !sceneId) throw new Error("Missing scene id");
  const doc = parseEditable(text);
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  const scenes = doc.get("scenes");
  if (!isSeq(scenes)) throw new Error("showcase.yaml has no scenes list");
  const matches = scenes.items
    .map((item, i) => (isMap(item) && item.get("id") === sceneId ? i : -1))
    .filter((i) => i >= 0);
  if (matches.length > 1) {
    /* First-match addressing would silently edit the wrong scene. */
    throw new Error(
      `${matches.length} scenes share the id "${sceneId}" — give each scene its own id, then edit`,
    );
  }
  const index = matches[0] ?? -1;
  if (index < 0) {
    const unquoted = scenes.items.find(
      (item) => isMap(item) && !isMap(item.get("id")) && String(item.get("id")) === sceneId,
    );
    if (unquoted) {
      throw new Error(
        `Scene id ${sceneId} is not text in showcase.yaml — quote it (id: "${sceneId}") to make the scene editable`,
      );
    }
    throw new Error(`No scene "${sceneId}"`);
  }

  if (field === "title") {
    const title = value.trim();
    if (title) doc.setIn(["scenes", index, "title"], title);
    else doc.deleteIn(["scenes", index, "title"]);
  } else if (field === "caption") {
    const captions = doc.getIn(["scenes", index, "captions"]);
    const line =
      isSeq(captions) && Number.isInteger(captionIndex) ? captions.items[captionIndex] : undefined;
    if (!isMap(line)) throw new Error(`Scene "${sceneId}" has no caption ${captionIndex}`);
    doc.setIn(["scenes", index, "captions", captionIndex, "text"], value.trim());
  } else if (field === "caption.insert") {
    if (typeof caption?.text !== "string") throw new Error("Missing caption text");
    refuseMisshapen(["scenes", 0, "captions", 0], caption, "The inserted caption");
    const captions = doc.getIn(["scenes", index, "captions"]);
    if (captions != null && !isSeq(captions)) {
      throw new Error(`Scene "${sceneId}" captions is not a list`);
    }
    const length = isSeq(captions) ? captions.items.length : 0;
    if (!Number.isInteger(captionIndex) || captionIndex < 0 || captionIndex > length) {
      throw new Error(`Caption index ${captionIndex} is out of range`);
    }
    if (isSeq(captions)) captions.items.splice(captionIndex, 0, doc.createNode(caption));
    else doc.setIn(["scenes", index, "captions"], doc.createNode([caption]));
  } else if (field === "caption.delete") {
    const captions = doc.getIn(["scenes", index, "captions"]);
    const exists =
      isSeq(captions) &&
      Number.isInteger(captionIndex) &&
      captionIndex >= 0 &&
      captionIndex < captions.items.length;
    if (!exists) throw new Error(`Scene "${sceneId}" has no caption ${captionIndex}`);
    captions.items.splice(captionIndex, 1);
  } else if (field === "scene.set") {
    const checked = checkFieldValue(SCENE_FIELDS, "scene", name, value);
    if (name === "id" && !checked.remove) {
      const clash = scenes.items.some(
        (item, i) => i !== index && isMap(item) && item.get("id") === checked.value,
      );
      if (clash) throw new Error(`A scene with the id "${checked.value}" already exists`);
    }
    /* A field that lives inside the scene (tiktok → media.tiktok) needs
     * that part of the scene to exist. */
    const path = SCENE_FIELDS[name].path ?? [name];
    if (path.length > 1 && !isMap(doc.getIn(["scenes", index, ...path.slice(0, -1)]))) {
      if (checked.remove) return editedText(doc);
      throw new Error(`Scene "${sceneId}" has no ${path.slice(0, -1).join(".")} to set ${name} on`);
    }
    if (name === "media" && !checked.remove) {
      mergeMedia(doc, index, sceneId, checked.value);
      return editedText(doc);
    }
    /* A playing rate only means something on a clip. */
    if (name === "speed" && !checked.remove) {
      const kind = doc.getIn(["scenes", index, "media", "kind"]);
      if (kind !== "video") {
        throw new Error(
          `Scene "${sceneId}" shows ${kind === "none" || kind == null ? "no media" : `a${kind === "image" ? "n" : ""} ${kind}`} — speed applies to a video`,
        );
      }
    }
    /* A new scene length keeps the captions' own timings in step with it
     * (unless a build, which writes every pin itself, says not to). */
    if (name === "durationMs" && !checked.remove && scaleCaptions !== false) {
      rescalePinnedCaptions(doc, index, checked.value);
    }
    setChecked(doc, ["scenes", index, ...path], checked);
  } else if (field === "caption.set") {
    const checked = checkFieldValue(CAPTION_FIELDS, "caption", name, value);
    const captions = doc.getIn(["scenes", index, "captions"]);
    const line =
      isSeq(captions) && Number.isInteger(captionIndex) ? captions.items[captionIndex] : undefined;
    if (!isMap(line)) throw new Error(`Scene "${sceneId}" has no caption ${captionIndex}`);
    setChecked(doc, ["scenes", index, "captions", captionIndex, name], checked);
  } else if (field === "scene.move") {
    if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex >= scenes.items.length) {
      throw new Error(`Scene index ${insertIndex} is out of range`);
    }
    const [moved] = scenes.items.splice(index, 1);
    scenes.items.splice(insertIndex, 0, moved);
  } else if (field === "scene.delete") {
    scenes.items.splice(index, 1);
  } else if (field === "media.asset") {
    if (!isMap(doc.getIn(["scenes", index, "media"]))) {
      throw new Error(`Scene "${sceneId}" has no media to point at an asset`);
    }
    doc.setIn(["scenes", index, "media", "asset"], value);
    if (mediaKind === "image" || mediaKind === "video") {
      doc.setIn(["scenes", index, "media", "kind"], mediaKind);
    }
  } else if (field === "media.set") {
    if (typeof media?.kind !== "string" || !media.kind) {
      throw new Error("The media mapping needs a kind");
    }
    doc.setIn(["scenes", index, "media"], doc.createNode(media));
  } else {
    throw new Error(`Unknown field "${String(field)}"`);
  }
  /* Written without wrapping, with text blocks kept as authored
   * (server/yaml-text.mjs). */
  return editedText(doc);
}
