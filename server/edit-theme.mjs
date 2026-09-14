/* Whitelisted, comment-preserving edits on a showcase's theme.yaml — the
 * write path behind the in-app style panel. Same discipline as
 * edit-yaml.mjs: parseDocument + setIn, never parse-and-redump.
 *
 * Only the keys the style panel offers are writable here — the loader's
 * theme whitelist (src/content/showcases.ts) rejects anything else at
 * load time, so this list must stay a subset of it:
 *
 *   colors:     caption-chip | caption-text | caption-word
 *   atmosphere: gradient-stage        (the slide background)
 *
 * An empty value deletes the key (and a group left empty), restoring the
 * default. A missing theme.yaml starts from an empty document.
 */
import { isMap } from "yaml";
import { editedText, parseEditable } from "./yaml-text.mjs";

const THEME_EDIT_KEYS = {
  colors: new Set(["caption-chip", "caption-text", "caption-word"]),
  atmosphere: new Set(["gradient-stage"]),
};

/** Applies one style-panel edit to theme.yaml text (undefined when the
 *  file doesn't exist yet) and returns the new text. Throws with a plain
 *  message when the edit can't be applied. */
export function applyThemeEdit(text, { group, name, value } = {}) {
  const names = THEME_EDIT_KEYS[group];
  if (!names) throw new Error(`Unknown theme group "${String(group)}"`);
  if (typeof name !== "string" || !names.has(name)) {
    throw new Error(`"${String(name)}" is not an editable ${group} key`);
  }
  if (typeof value !== "string") throw new Error("Missing value");
  const doc = parseEditable(text ?? "");
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  if (value) {
    doc.setIn([group, name], value);
  } else {
    doc.deleteIn([group, name]);
    const remaining = doc.get(group);
    if (isMap(remaining) && remaining.items.length === 0) doc.deleteIn([group]);
    /* A fully emptied theme reads better as an empty file than "{}". */
    if (isMap(doc.contents) && doc.contents.items.length === 0) return "";
  }
  return editedText(doc);
}
