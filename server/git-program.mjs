/* Where git is, found once. Started by its bare name, git costs a search
 * along PATH on every run: on a Mac each folder before git's adds about
 * 4–5 ms to the start (even a folder that doesn't exist), and a PATH of
 * a dozen such folders made each git command 40–50 ms where the full
 * path takes 6 ms. A studio commit runs about ten git commands, so the
 * studio looks git up here instead: once, by reading the folders itself,
 * and runs it by its full path after that. The history
 * (showcase-history.mjs) and library-git.mjs both use it. */
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

/** The full path of `name` on `searchPath`, or undefined when no folder
 *  on it holds a program by that name. On Windows the program is
 *  `<name>.exe`: a .cmd or .bat would need a shell to run. */
export function findOnPath(name, { searchPath = "", platform = process.platform } = {}) {
  const file = platform === "win32" ? `${name}.exe` : name;
  const separator = platform === "win32" ? ";" : ":";
  for (const dir of searchPath.split(separator)) {
    if (!dir || !path.isAbsolute(dir)) continue; // "" or "." would mean the working folder
    const candidate = path.join(dir, file);
    try {
      if (!statSync(candidate).isFile()) continue;
      if (platform !== "win32") accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      /* not here */
    }
  }
  return undefined;
}

let found;

/** git's full path, looked up the first time and kept while the file is
 *  there. Plain "git" when PATH holds none, so running it fails the usual
 *  way (ENOENT) and the next call looks again — git may be installed by
 *  then. */
export function gitProgram() {
  if (found && isFile(found)) return found;
  found = findOnPath("git", { searchPath: process.env.PATH ?? process.env.Path ?? "" });
  return found ?? "git";
}

function isFile(file) {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}
