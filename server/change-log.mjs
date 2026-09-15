/* The change log: one JSON line for every write the studio makes on
 * someone's behalf — a page edit ("ui") or an MCP tool call ("mcp") —
 * appended to <library>/.studio/changes.jsonl.
 *
 * It lets a Claude session and a person in the studio work on the same
 * showcase at once. The watcher swallows the studio's own writes (so the
 * page doesn't flash), which means Claude would never hear about a UI
 * edit; instead it follows this file:
 *
 *   tail -n 0 -F <library>/.studio/changes.jsonl | grep --line-buffered '"source":"ui"'
 *
 * Every line starts with the same four keys, in this order, so a grep
 * on the compact JSON works:
 *
 *   at          ISO timestamp
 *   source      "ui" | "mcp"
 *   showcaseId  the showcase folder
 *   kind        "edit" | "asset.add" | "asset.rename" | "asset.delete" | "showcase.create"
 *
 * then what changed. A line that changed a YAML file also names the file
 * and its content hash before and after (previousVersion, version) —
 * the same hash read_showcase and edit_showcase report — so a refused
 * stale edit can list what happened since the version it was made against.
 *
 * The log stays bounded by rotating: when changes.jsonl would pass
 * maxBytes it is renamed to changes.1.jsonl (replacing the older copy)
 * and a fresh file starts. `tail -F` follows the new file from its first
 * line, so a rotation never replays old entries. */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import path from "node:path";

export const CHANGE_LOG = path.join(".studio", "changes.jsonl");
const ROTATED = path.join(".studio", "changes.1.jsonl");

/** A change log for the library `getDir()` names (it can switch). */
export function createChangeLog(getDir, { maxBytes = 256 * 1024, log = console.warn } = {}) {
  const readLines = (file) => {
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        try {
          return line.trim() ? [JSON.parse(line)] : [];
        } catch {
          return []; // a torn line from a crash, or a hand edit
        }
      });
  };

  return {
    /** The log file's path in the current library. */
    path: () => path.join(getDir(), CHANGE_LOG),

    /** Appends one entry. Never throws: a log that can't be written must
     *  not fail the edit it describes. */
    append({ source, showcaseId, kind, ...details }) {
      const entry = { at: new Date().toISOString(), source, showcaseId, kind, ...details };
      try {
        const file = path.join(getDir(), CHANGE_LOG);
        mkdirSync(path.dirname(file), { recursive: true });
        const line = JSON.stringify(entry) + "\n";
        if (existsSync(file) && statSync(file).size + Buffer.byteLength(line) > maxBytes) {
          renameSync(file, path.join(getDir(), ROTATED));
        }
        appendFileSync(file, line);
      } catch (error) {
        log(`studio: couldn't write the change log (${error.message})`);
      }
      return entry;
    },

    /** Every entry the log still holds, oldest first. */
    entries: () => [
      ...readLines(path.join(getDir(), ROTATED)),
      ...readLines(path.join(getDir(), CHANGE_LOG)),
    ],

    /** What changed in one showcase's `file` since it had content hash
     *  `version`: `{ known: true, entries }` when the log holds the write
     *  that produced (or replaced) that version — every entry for the
     *  showcase after that point, of any kind — or `{ known: false,
     *  entries }` with the showcase's latest few entries when it doesn't
     *  (the file was changed outside the studio, or too long ago). */
    since(showcaseId, file, version, { recent = 10 } = {}) {
      const all = this.entries();
      const mine = (e) => e.showcaseId === showcaseId;
      const sameFile = (e) => mine(e) && e.file === file;
      let start = all.findLastIndex((e) => sameFile(e) && e.version === version) + 1;
      if (start === 0) start = all.findIndex((e) => sameFile(e) && e.previousVersion === version);
      if (start < 0) return { known: false, entries: all.filter(mine).slice(-recent) };
      return { known: true, entries: all.slice(start).filter(mine) };
    },
  };
}

/** A page's scene-edit payload in the shape edit_showcase takes, so the
 *  log reads the same whoever made the edit: the page's older ops
 *  (title, caption, meta.captionStyle) become scene.set / caption.set /
 *  meta.set, and the payload's bookkeeping (showcaseId, baseHash) drops
 *  out. */
export function editForLog(payload = {}) {
  const { showcaseId: _id, baseHash: _base, field, sceneId, ...rest } = payload;
  const params = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  switch (field) {
    case "title":
      return { field: "scene.set", sceneId, name: "title", value: params.value };
    case "caption":
      return {
        field: "caption.set",
        sceneId,
        captionIndex: params.captionIndex,
        name: "text",
        value: params.value,
      };
    case "meta.captionStyle":
      return { field: "meta.set", name: "captionStyle", value: params.value };
    case "meta.set":
    case "scene.insert":
    case "theme":
      return { field, ...params };
    default:
      return { field, sceneId, ...params };
  }
}
