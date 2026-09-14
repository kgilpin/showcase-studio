/* The studio's command-line options — one list, shared by the dev modes
 * (scripts/dev.mjs), the studio Claude Code starts (scripts/studio-mcp.mjs,
 * which validates its studio_start choices here), and the Electron shell
 * (electron/main.mjs), and printed by --help. Settings a person picks are
 * flags; the environment is left for launchers (PORT), secrets, and test
 * hooks.
 *
 * Both --flag value and --flag=value work. Relative paths resolve against
 * `cwd`. Arguments that aren't studio options (Electron's, Chromium's, the
 * script path) are returned in `unknown` (--flags only) or ignored; the
 * shell can't reject them, the dev script can.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

export const EXPORT_KINDS = [
  "screens",
  "script",
  "video",
  "video-draft",
  "video-43",
  "video-43-draft",
];

export const STUDIO_USAGE = `Showcase Studio

Usage:
  npm run dev -- [options]                        the studio, in your browser
  npm run dev:electron -- [options]               the same studio, in a desktop window
  open -n "Showcase Studio.app" --args [options]  the packaged desktop app

The studio picks a free port and prints its URL (a launcher can pick the
port by setting PORT). Claude Code starts a studio of its own through
.mcp.json (scripts/studio-mcp.mjs); its studio_start tool offers the same
choices as --open, --new, and --library.

Options:
  --open <showcase folder>   Open one showcase and lock the studio to it.
                             Its parent folder is the library.
  --new [<library folder>]   Open the New showcase page. The studio locks
                             to the showcase you create.
  --library <folder>         Use this showcases folder. Default: this repo's
                             showcases/ from source; in the packaged app, the
                             last folder opened, or ~/Showcases.
  --export <kind>:<id>       Export one showcase, then quit.
                             Kinds: ${EXPORT_KINDS.join(", ")}.
  -h, --help                 Show this help.

Set by the npm scripts:
  --electron                 Show the studio in a desktop window.
  --app-url <url>            (Electron window) Show this running studio.

Relative paths are resolved from the folder you run the command in.
`;

const VALUE_FLAGS = new Set(["open", "library", "export", "app-url"]);
const SWITCHES = new Set(["help", "electron"]);

const isDirectory = (dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** Parses argv into the studio's options:
 *  `{ help, electron, showcasesDir, lock, exportJob, appUrl, unknown }`.
 *  `showcasesDir` is `defaultDir` unless --library, --open or --new picks
 *  one. Throws with a plain message when an option is misused or names a
 *  folder that won't work. */
export function studioOptions(argv, { cwd, defaultDir } = {}) {
  const given = new Map();
  const unknown = [];
  const setOnce = (name, value) => {
    if (given.has(name)) throw new Error(`--${name} is given more than once.`);
    given.set(name, value);
  };

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "-h") {
      setOnce("help", true);
      continue;
    }
    const match = /^--([a-z][a-z-]*)(?:=(.*))?$/.exec(argv[i]);
    if (!match) continue;
    const [, name, inline] = match;
    if (SWITCHES.has(name)) {
      if (inline !== undefined) throw new Error(`--${name} doesn't take a value.`);
      setOnce(name, true);
    } else if (VALUE_FLAGS.has(name) || name === "new") {
      let value = inline;
      if (value === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith("-")) {
        i += 1;
        value = argv[i];
      }
      if (!value && name !== "new") throw new Error(`--${name} needs a value.`);
      setOnce(name, value ?? "");
    } else {
      unknown.push(argv[i]);
    }
  }

  const options = {
    help: given.has("help"),
    electron: given.has("electron"),
    showcasesDir: defaultDir,
    lock: null,
    exportJob: undefined,
    appUrl: undefined,
    unknown,
  };
  if (options.help) return options;

  const folder = (value) => {
    const dir = path.resolve(cwd, value);
    if (!isDirectory(dir)) throw new Error(`${dir} is not a folder.`);
    return dir;
  };

  if (given.has("open") && given.has("new")) throw new Error("Use --open or --new, not both.");
  if (given.has("open") && given.has("library")) {
    throw new Error("--open already picks the library: the showcase folder's parent.");
  }
  if (given.get("new") && given.has("library")) {
    throw new Error("Give the library once: --new <folder> or --library <folder>.");
  }

  if (given.has("library")) options.showcasesDir = folder(given.get("library"));

  if (given.has("open")) {
    const dir = path.resolve(cwd, given.get("open"));
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
    options.showcasesDir = path.dirname(dir);
    options.lock = { kind: "showcase", showcaseId: path.basename(dir) };
  }

  if (given.has("new")) {
    if (given.get("new")) options.showcasesDir = folder(given.get("new"));
    options.lock = { kind: "new" };
  }

  if (given.has("export")) {
    if (options.lock || options.electron) {
      throw new Error(
        "--export runs without a window, so it can't be used with --open, --new, or --electron.",
      );
    }
    const job = /^([a-z0-9-]+):(?!\.\.?$)([^/\\]+)$/.exec(given.get("export"));
    if (!job || !EXPORT_KINDS.includes(job[1])) {
      throw new Error(
        `--export needs <kind>:<showcase id>, where kind is one of: ${EXPORT_KINDS.join(", ")}.`,
      );
    }
    options.exportJob = { kind: job[1], showcaseId: job[2] };
  }

  if (given.has("app-url")) {
    const value = given.get("app-url");
    if (!/^https?:\/\/[^/\s]+\/?$/.test(value)) {
      throw new Error("--app-url needs the studio's address, like http://localhost:5173.");
    }
    options.appUrl = value.replace(/\/$/, "");
  }

  return options;
}
