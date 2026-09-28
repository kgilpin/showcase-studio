/* Library-level settings: a showcase_settings.yaml at the ROOT of a
 * showcases folder. The studio writes one (all comments) into every
 * library it opens, so the file also marks the folder as a library —
 * even before it holds any showcases. One setting so far:
 *
 *   show_in_recent: false    keep this folder out of File > Open Recent
 *
 * Unknown keys are ignored.
 *
 * Older libraries keep their settings in a root-level showcase.yaml — the
 * same name as each showcase's own <id>/showcase.yaml, one level down.
 * The studio renames it to showcase_settings.yaml when it opens the
 * library (migrateLibrarySettings). Until then it is still read, as long
 * as it has no `scenes` or `meta` (those make it a showcase's script,
 * never settings): Open Recent and findLibrary look at folders
 * no studio has opened since.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export const SETTINGS_FILE = "showcase_settings.yaml";
const OLD_SETTINGS_FILE = "showcase.yaml";

/** The parsed YAML mapping in `file`, or undefined when the file is
 *  missing, unparsable, or not a mapping. */
function readMapping(file) {
  try {
    const parsed = parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The old-style settings in `dir`/showcase.yaml: a mapping with no
 *  `scenes` or `meta`. Undefined for a showcase's script — even one still
 *  being written — or anything unreadable. */
function oldSettings(dir) {
  const parsed = readMapping(path.join(dir, OLD_SETTINGS_FILE));
  return parsed && !("scenes" in parsed) && !("meta" in parsed) ? parsed : undefined;
}

/** True when `dir` has library settings: a showcase_settings.yaml, or an
 *  old-style root showcase.yaml with no scenes. Such a folder is a
 *  library, not a showcase. */
export function hasLibrarySettings(dir) {
  return existsSync(path.join(dir, SETTINGS_FILE)) || oldSettings(dir) !== undefined;
}

/** Renames an older library's root showcase.yaml to
 *  showcase_settings.yaml. Only when it is settings (no `scenes` or `meta`) and
 *  showcase_settings.yaml isn't there yet. Returns true when it moved. */
export function migrateLibrarySettings(dir) {
  if (existsSync(path.join(dir, SETTINGS_FILE)) || oldSettings(dir) === undefined) return false;
  renameSync(path.join(dir, OLD_SETTINGS_FILE), path.join(dir, SETTINGS_FILE));
  return true;
}

/** What a new library's showcase_settings.yaml says: nothing set yet. */
export const SETTINGS_TEMPLATE = `# Showcase Studio library settings.
#
# This file marks this folder as a library of showcases: each showcase is
# a folder beside it, with its own showcase.yaml. Settings go below;
# remove the # to turn one on.
#
# show_in_recent: false   # keep this folder out of File > Open Recent
`;

/** Gives the library its settings file: renames an older root
 *  showcase.yaml, or writes the commented template when there is none. */
export function ensureLibrarySettings(dir) {
  if (migrateLibrarySettings(dir) || existsSync(path.join(dir, SETTINGS_FILE))) return;
  writeFileSync(path.join(dir, SETTINGS_FILE), SETTINGS_TEMPLATE);
}

/** The folder's library settings, {} when there are none or the file is
 *  unparsable or not a mapping. */
export function libraryConfig(dir) {
  if (existsSync(path.join(dir, SETTINGS_FILE))) {
    return readMapping(path.join(dir, SETTINGS_FILE)) ?? {};
  }
  return oldSettings(dir) ?? {};
}

/** False only when the folder's settings say show_in_recent: false. */
export function showInRecent(dir) {
  return libraryConfig(dir).show_in_recent !== false;
}
