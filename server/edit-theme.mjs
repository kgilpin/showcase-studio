/* Whitelisted, comment-preserving edits on a showcase's theme.yaml — the
 * write path behind the in-app style panel and the edit_theme tool. Same
 * discipline as edit-yaml.mjs: parseDocument + setIn, never
 * parse-and-redump.
 *
 * Every key the loader accepts is writable here, checked by the same
 * rules (src/content/theme-rules.mjs), so an edit can't leave a theme
 * the loader refuses:
 *
 *   extends                          another showcase's id
 *   colors.<name> fonts.display fonts.body shape.radius atmosphere.<name>
 *                                    a CSS value
 *   fonts.load                       a list of stylesheet URLs
 *
 * An empty value (null, "" or an empty list) deletes the key (and a group
 * left empty), restoring the default. A missing theme.yaml starts from an
 * empty document. */
import { isMap } from "yaml";
import { editedText, parseEditable } from "./yaml-text.mjs";
import { THEME_KEYS, themeValueProblem } from "../src/content/theme-rules.mjs";

const isEmpty = (value) =>
  value == null || value === "" || (Array.isArray(value) && value.length === 0);

/** Applies a list of {key, value} edits to theme.yaml text (undefined
 *  when the file doesn't exist yet), in order, and returns the new text.
 *  Throws with a plain message naming the first edit that can't be
 *  applied. */
export function applyThemeEdits(text, edits) {
  const doc = parseEditable(text ?? "");
  if (doc.errors.length > 0) throw new Error(doc.errors[0].message);
  for (const [i, edit] of edits.entries()) {
    const where = edits.length > 1 ? `Edit ${i + 1} of ${edits.length}: ` : "";
    const key = edit?.key;
    if (typeof key !== "string" || !key) {
      throw new Error(`${where}Each edit needs a key, like "colors.primary"`);
    }
    /* An unknown key gets the loader's own message, which lists the keys
     * its group takes. */
    if (!THEME_KEYS.includes(key)) throw new Error(`${where}${themeValueProblem(key, "")}`);
    const keyPath = key.split(/\.(.*)/s).filter(Boolean);
    if (isEmpty(edit.value)) {
      /* Clearing a key that isn't there is a no-op, not an error. */
      if (doc.hasIn(keyPath)) doc.deleteIn(keyPath);
      const group = keyPath.length > 1 ? doc.get(keyPath[0]) : undefined;
      if (isMap(group) && group.items.length === 0) doc.deleteIn([keyPath[0]]);
      continue;
    }
    const problem = themeValueProblem(key, edit.value);
    if (problem) throw new Error(`${where}${problem}`);
    doc.setIn(keyPath, edit.value);
  }
  /* A fully emptied theme reads better as an empty file than "{}". */
  if (isMap(doc.contents) && doc.contents.items.length === 0) return "";
  return editedText(doc);
}

/** Applies one style-panel edit ({group, name, value}, value a string)
 *  and returns the new text. */
export function applyThemeEdit(text, { group, name, value } = {}) {
  if (typeof value !== "string") throw new Error("Missing value");
  return applyThemeEdits(text, [{ key: `${String(group)}.${String(name)}`, value }]);
}
