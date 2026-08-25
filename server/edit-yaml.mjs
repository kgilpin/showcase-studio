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
 *   { field: "media.set",   media }                 replace the whole
 *                                                   media mapping (the
 *                                                   graphic ↔ asset swap)
 *   { field: "meta.captionStyle", value }           showcase-wide caption
 *                                                   painting, chip|karaoke
 *                                                   (empty deletes; no
 *                                                   sceneId — it's meta)
 */
import { isMap, isSeq, parseDocument } from "yaml";

const CAPTION_STYLES = ["chip", "karaoke", "reveal"];

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
  } = {},
) {
  const needsValue = ["title", "caption", "media.asset", "meta.captionStyle"].includes(field);
  if (needsValue && typeof value !== "string") throw new Error("Missing value");

  /* Meta edits address the showcase, not a scene. */
  if (field === "meta.captionStyle") {
    if (value !== "" && !CAPTION_STYLES.includes(value)) {
      throw new Error(`captionStyle must be one of: ${CAPTION_STYLES.join(", ")}`);
    }
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
    if (!isMap(doc.get("meta"))) throw new Error("showcase.yaml has no meta section");
    if (value) doc.setIn(["meta", "captionStyle"], value);
    else doc.deleteIn(["meta", "captionStyle"]);
    return doc.toString({ lineWidth: 0 });
  }

  /* Scene insertion addresses a position, not a scene. */
  if (field === "scene.insert") {
    if (typeof scene?.id !== "string" || !scene.id) {
      throw new Error("The inserted scene needs a text id");
    }
    const doc = parseDocument(text);
    if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
    const scenes = doc.get("scenes");
    if (!isSeq(scenes)) throw new Error("showcase.yaml has no scenes list");
    if (scenes.items.some((item) => isMap(item) && item.get("id") === scene.id)) {
      throw new Error(`A scene with the id "${scene.id}" already exists`);
    }
    if (!Number.isInteger(insertIndex) || insertIndex < 0 || insertIndex > scenes.items.length) {
      throw new Error(`Scene index ${insertIndex} is out of range`);
    }
    scenes.items.splice(insertIndex, 0, doc.createNode(scene));
    return doc.toString({ lineWidth: 0 });
  }

  if (sceneId != null && sceneId !== "" && typeof sceneId !== "string") {
    /* YAML read the id as a number or boolean (id: 2024, id: on) — the
     * scene renders fine but can't be addressed. Name the real problem. */
    throw new Error(
      `Scene id ${JSON.stringify(sceneId)} is not text in showcase.yaml — quote it (id: "${String(sceneId)}") to make the scene editable`,
    );
  }
  if (typeof sceneId !== "string" || !sceneId) throw new Error("Missing scene id");
  const doc = parseDocument(text);
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
  /* lineWidth 0 disables wrapping — a long authored line must not come
   * back folded just because a neighbouring field was edited. */
  return doc.toString({ lineWidth: 0 });
}
