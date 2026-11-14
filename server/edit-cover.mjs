/* Comment-preserving edits on a showcase's cover.yaml — the write path
 * behind the Cover page and the edit_cover tool. Same discipline as
 * edit-yaml.mjs: parseDocument + setIn, never parse-and-redump.
 *
 * One kind of edit: `{destination?, name, value}` sets one field of the
 * default cover, or of one destination's own block. A null or "" value
 * removes the field, so the destination falls back to the default (and
 * the default to the layout's own). The fields and their values are
 * src/content/cover-rules.mjs's, which the loader checks too. A missing
 * cover.yaml starts from an empty document: the first edit makes the
 * cover. */
import { isMap, isSeq } from "yaml";
import { checkCoverEdit } from "../src/content/cover-rules.mjs";
import { editedText, parseEditable } from "./yaml-text.mjs";

/** Applies one edit to cover.yaml text (undefined when the file doesn't
 *  exist yet) and returns the new text. Throws with a plain message when
 *  the edit can't be applied. */
export function applyCoverEdit(text, { destination, name, value } = {}) {
  checkCoverEdit({ destination, name, value });
  const doc = parseEditable(text ?? "");
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  if (doc.contents != null && !isMap(doc.contents)) {
    throw new Error("cover.yaml must be a map of fields");
  }
  const at = destination ? [destination, name] : [name];
  if (value === null || value === "" || value === undefined) {
    doc.deleteIn(at);
    if (destination) {
      const block = doc.get(destination);
      if (isMap(block) && block.items.length === 0) doc.deleteIn([destination]);
    }
  } else {
    const node = doc.createNode(value);
    /* One graphic to a line: - { graphic: arrow, at: bottom-right, size: 30 } */
    if (isSeq(node)) for (const item of node.items) if (isMap(item)) item.flow = true;
    doc.setIn(at, node);
  }
  return editedText(doc);
}
