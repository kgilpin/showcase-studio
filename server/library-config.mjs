/* Library-level settings: a showcase.yaml at the ROOT of a showcases
 * folder (not to be confused with each showcase's own
 * <id>/showcase.yaml, which lives one level down and is discovered as a
 * showcase — the root file never is). One setting so far:
 *
 *   show_in_recent: false    keep this folder out of File > Open Recent
 *
 * Unknown keys are ignored.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";

/** The folder's library settings, {} when the file is missing,
 *  unparsable, or not a mapping. */
export function libraryConfig(dir) {
  try {
    const parsed = parse(readFileSync(path.join(dir, "showcase.yaml"), "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/** False only when the folder's showcase.yaml says show_in_recent: false. */
export function showInRecent(dir) {
  return libraryConfig(dir).show_in_recent !== false;
}
