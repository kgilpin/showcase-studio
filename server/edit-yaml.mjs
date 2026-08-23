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
 *   { field: "media.asset", value, mediaKind? }     media.asset
 *                                                   (+ media.kind when the
 *                                                   new asset is a video
 *                                                   and the old an image,
 *                                                   or vice versa)
 */
import { isMap, isSeq, parseDocument } from "yaml";

/** Applies one scene edit to showcase.yaml text and returns the new text.
 *  Throws with a plain message when the edit can't be applied. */
export function applySceneEdit(text, { sceneId, field, captionIndex, value, mediaKind } = {}) {
  if (sceneId != null && sceneId !== "" && typeof sceneId !== "string") {
    /* YAML read the id as a number or boolean (id: 2024, id: on) — the
     * scene renders fine but can't be addressed. Name the real problem. */
    throw new Error(
      `Scene id ${JSON.stringify(sceneId)} is not text in showcase.yaml — quote it (id: "${String(sceneId)}") to make the scene editable`,
    );
  }
  if (typeof sceneId !== "string" || !sceneId) throw new Error("Missing scene id");
  if (typeof value !== "string") throw new Error("Missing value");
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
  } else if (field === "media.asset") {
    if (!isMap(doc.getIn(["scenes", index, "media"]))) {
      throw new Error(`Scene "${sceneId}" has no media to point at an asset`);
    }
    doc.setIn(["scenes", index, "media", "asset"], value);
    if (mediaKind === "image" || mediaKind === "video") {
      doc.setIn(["scenes", index, "media", "kind"], mediaKind);
    }
  } else {
    throw new Error(`Unknown field "${String(field)}"`);
  }
  /* lineWidth 0 disables wrapping — a long authored line must not come
   * back folded just because a neighbouring field was edited. */
  return doc.toString({ lineWidth: 0 });
}
