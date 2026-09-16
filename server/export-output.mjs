/* Where finished exports go, and how the previous one is kept.
 *
 * An export is written to a hidden partial name next to its final name,
 * and moved in only when it succeeds. Moving it in keeps the older
 * exports, numbered — the plain name is always the newest:
 *
 *   before:  gold-traces_draft.mp4     gold-traces_draft.1.mp4
 *   after:   gold-traces_draft.mp4 (new)
 *            gold-traces_draft.1.mp4   (was the plain name)
 *            gold-traces_draft.2.mp4   (was .1)
 *
 * A folder (the screenshot set, screens/) is kept the same way: screens.1,
 * screens.2. A failed or canceled export never touches what is there.
 *
 * revealInFileManager opens the system file manager on an export. */
import { spawn } from "node:child_process";
import { existsSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

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

/** Moves a finished export from `fromPath` to `finalPath`, first moving
 *  each older export up one number (N → N+1, the plain name → 1). Returns
 *  finalPath. */
export function moveIntoPlace(fromPath, finalPath) {
  const isDir = statSync(fromPath).isDirectory();
  const dir = path.dirname(finalPath);
  const [stem, ext] = nameParts(finalPath, isDir);
  const numbered = new RegExp(`^${escapeRegExp(stem)}\\.(\\d+)${escapeRegExp(ext)}$`);
  const numbers = readdirSync(dir)
    .map((name) => numbered.exec(name)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => b - a);
  const withNumber = (n) => path.join(dir, `${stem}.${n}${ext}`);
  // Highest first, so no rename lands on a name still in use.
  for (const n of numbers) renameSync(withNumber(n), withNumber(n + 1));
  if (existsSync(finalPath)) renameSync(finalPath, withNumber(1));
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
