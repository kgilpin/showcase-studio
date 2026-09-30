/* Where finished exports go, and how the previous ones are kept.
 *
 * An export is written to a hidden partial name next to its final name,
 * and moved in only when it succeeds. The export folder holds only the
 * newest export of each kind; moving a new one in moves the older ones
 * into history/, numbered from the newest:
 *
 *   before:  gold-traces_draft.mp4         history/gold-traces_draft.1.mp4
 *   after:   gold-traces_draft.mp4 (new)
 *            history/gold-traces_draft.1.mp4   (was the plain name)
 *            history/gold-traces_draft.2.mp4   (was .1)
 *
 * A folder (the screenshot set, screens/) is kept the same way:
 * history/screens.1, history/screens.2. Numbered exports an earlier
 * studio left beside the plain name (gold-traces_draft.1.mp4) move into
 * history/ too, after the ones already there. A failed or canceled
 * export never touches what is there.
 *
 * revealInFileManager opens the system file manager on an export. */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Where exports land unless a studio is told otherwise:
 *  <Downloads>/showcase-exports/<showcase id>. */
export const DEFAULT_EXPORT_DIR = path.join(os.homedir(), "Downloads", "showcase-exports");

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The name parts rotation numbers between: "clip.mp4" → ["clip", ".mp4"],
 *  and a folder's whole name → ["screens", ""]. */
function nameParts(finalPath, isDir) {
  const name = path.basename(finalPath);
  if (isDir) return [name, ""];
  const ext = path.extname(name);
  return [name.slice(0, name.length - ext.length), ext];
}

/** The hidden name an export is written to before it is finished:
 *  ".clip.partial.mp4" (the extension stays last so ffmpeg picks the
 *  format) or ".screens.partial". */
export function partialPath(finalPath, { isDir = false } = {}) {
  const [stem, ext] = nameParts(finalPath, isDir);
  return path.join(path.dirname(finalPath), `.${stem}.partial${ext}`);
}

/** The folder older exports move to, inside an export folder. */
export const HISTORY_DIR = "history";

/** The numbered copies of an export in `dir` ("clip.2.mp4" → 2), lowest
 *  number first. */
export function numberedCopies(dir, stem, ext) {
  const numbered = new RegExp(`^${escapeRegExp(stem)}\\.(\\d+)${escapeRegExp(ext)}$`);
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => [name, numbered.exec(name)?.[1]])
    .filter(([, n]) => n != null)
    .sort((a, b) => Number(a[1]) - Number(b[1]))
    .map(([name]) => path.join(dir, name));
}

/** Moves a finished export from `fromPath` to `finalPath`, first moving
 *  the older exports of the same name into history/ and numbering them
 *  from the newest: the plain name becomes 1, history's 1 becomes 2, and
 *  so on. Returns finalPath. */
export function moveIntoPlace(fromPath, finalPath) {
  const isDir = statSync(fromPath).isDirectory();
  const dir = path.dirname(finalPath);
  const history = path.join(dir, HISTORY_DIR);
  const [stem, ext] = nameParts(finalPath, isDir);
  /* Newest first: the plain name, history's copies, then any an earlier
   * studio numbered beside the plain name. */
  const older = [
    ...(existsSync(finalPath) ? [finalPath] : []),
    ...numberedCopies(history, stem, ext),
    ...numberedCopies(dir, stem, ext),
  ];
  if (older.length > 0) {
    mkdirSync(history, { recursive: true });
    /* Through hidden names first, so no rename lands on a name still in
     * use. */
    const moving = older.map((file, i) => {
      const temp = path.join(history, `.${stem}.moving-${i}${ext}`);
      renameSync(file, temp);
      return temp;
    });
    moving.forEach((temp, i) => renameSync(temp, path.join(history, `${stem}.${i + 1}${ext}`)));
  }
  renameSync(fromPath, finalPath);
  return finalPath;
}

/** Removes a partial export left by a failure or a cancel. */
export function removePartial(partial) {
  rmSync(partial, { recursive: true, force: true });
}

/** The command that opens the file manager on `target`: selecting it when
 *  it is a file, opening it when it is a folder. */
export function revealCommand(target, { platform = process.platform, isDir = false } = {}) {
  if (platform === "darwin") return ["open", isDir ? [target] : ["-R", target]];
  if (platform === "win32") return ["explorer", isDir ? [target] : [`/select,${target}`]];
  return ["xdg-open", [isDir ? target : path.dirname(target)]];
}

/** Opens the system file manager on `target` (Finder on a Mac). Doesn't
 *  wait for it. */
export function revealInFileManager(target) {
  const [command, args] = revealCommand(target, { isDir: statSync(target).isDirectory() });
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}
