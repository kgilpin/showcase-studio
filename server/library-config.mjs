/* Library-level settings: a showcase_settings.yaml at the ROOT of a
 * showcases folder. One setting so far:
 *
 *   show_in_recent: false    keep this folder out of File > Open Recent
 *
 * Unknown keys are ignored.
 *
 * Older libraries keep their settings in a root-level showcase.yaml — the
 * same name as each showcase's own <id>/showcase.yaml, one level down.
 * That file is still read when showcase_settings.yaml is missing, as long
 * as it has no `scenes` (a showcase.yaml with scenes is a showcase's
 * script, never settings). The studio doesn't rename it.
 */
import { existsSync, readFileSync } from "node:fs";
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
 *  `scenes`. Undefined for a showcase's script or anything unreadable. */
function oldSettings(dir) {
  const parsed = readMapping(path.join(dir, OLD_SETTINGS_FILE));
  return parsed && !("scenes" in parsed) ? parsed : undefined;
}

/** True when `dir` has library settings: a showcase_settings.yaml, or an
 *  old-style root showcase.yaml with no scenes. Such a folder is a
 *  library, not a showcase. */
export function hasLibrarySettings(dir) {
  return existsSync(path.join(dir, SETTINGS_FILE)) || oldSettings(dir) !== undefined;
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
