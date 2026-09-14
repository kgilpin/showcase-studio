/* Launch options that pin the studio window (src/lib/window-lock.mjs):
 *
 *   --open <showcase folder>    open that one showcase; its parent
 *                               folder is the library for this run
 *   --new [<library folder>]    open the New Showcase page; without a
 *                               folder, the usual library is used
 *
 * Both also accept --flag=value. Relative paths resolve against `cwd`.
 * Every other argument (Electron's, Chromium's, the script path) is
 * ignored.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const isDirectory = (dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** Reads --open / --new from argv. Returns null when neither is given,
 *  otherwise `{ showcasesDir, lock }`. Throws with a plain message when
 *  the options are misused or name a folder that won't work. */
export function launchOptions(argv, { cwd, defaultDir }) {
  const found = [];
  for (let i = 0; i < argv.length; i += 1) {
    const match = /^--(open|new)(?:=(.*))?$/.exec(argv[i]);
    if (!match) continue;
    let value = match[2];
    if (value === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith("-")) {
      i += 1;
      value = argv[i];
    }
    found.push({ flag: match[1], value });
  }
  if (found.length === 0) return null;
  if (found.length > 1) throw new Error("Use one launch option: --open or --new, once.");

  const [{ flag, value }] = found;
  if (flag === "open") {
    if (!value) throw new Error("--open needs a showcase folder, e.g. --open ~/Showcases/nova");
    const dir = path.resolve(cwd, value);
    if (!isDirectory(dir) || !existsSync(path.join(dir, "showcase.yaml"))) {
      throw new Error(`${dir} is not a showcase folder: it has no showcase.yaml.`);
    }
    /* A library can have its own root showcase.yaml (library settings),
     * so a showcase.yaml alone doesn't prove this is one showcase. */
    const holdsShowcases = readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "showcase.yaml")),
    );
    if (holdsShowcases) {
      throw new Error(
        `${dir} is a library of showcases. Pass one showcase folder inside it to --open.`,
      );
    }
    return {
      showcasesDir: path.dirname(dir),
      lock: { kind: "showcase", showcaseId: path.basename(dir) },
    };
  }

  const dir = value ? path.resolve(cwd, value) : defaultDir;
  if (value && !isDirectory(dir)) throw new Error(`${dir} is not a folder.`);
  return { showcasesDir: dir, lock: { kind: "new" } };
}
