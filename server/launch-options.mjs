/* The studio's command-line options — one list, shared by the dev modes
 * (scripts/dev.mjs), the studio Claude Code starts (server/mcp-stdio.mjs,
 * which validates its studio_start choices here), and the Electron shell
 * (electron/main.mjs), and printed by --help. Settings a person picks are
 * flags; the environment is left for launchers (PORT), secrets, and test
 * hooks.
 *
 * Both --flag value and --flag=value work. A leading ~ is the home folder,
 * and relative paths resolve against `cwd`. Arguments that aren't studio
 * options (Electron's, Chromium's, the script path) are returned in
 * `unknown` (--flags only) or ignored; the shell can't reject them, the
 * dev script can.
 *
 * --open and --new lock the studio to one showcase. Which pages are
 * inside a lock, and which capture pages ignore it, is decided in
 * src/lib/window-lock.mjs. libraryForClaude picks the library for the
 * studio Claude Code starts.
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { hasLibrarySettings } from "./library-config.mjs";

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
  showcase-studio/bin/showcase-studio [options]   the Linux build, with no window

The studio picks a free port and prints its URL (a launcher can pick the
port by setting PORT). Claude Code starts a studio of its own: in this
repo through .mcp.json (scripts/studio-mcp.mjs), and anywhere else through
the showcase-studio plugin, which runs the packaged app (or the Linux
build) with --mcp. Its studio_start tool offers the same choices as
--open, --new, and --library.

Options:
  --open <showcase folder>   Open one showcase and lock the studio to it.
                             Its parent folder is the library.
  --new [<library folder>]   Open the New showcase page. The studio locks
                             to the showcase you create.
  --library <folder>         Use this showcases folder. Default: this repo's
                             showcases/ from source; in the packaged app, the
                             last folder opened, or ~/Showcases. With --mcp,
                             the folder Claude Code runs in; when it holds
                             other files, Claude asks the user first.
  --export <kind>:<id>       Export one showcase, then quit.
                             Kinds: ${EXPORT_KINDS.join(", ")}.
  --no-terminal              Turn off the studio agent's embedded terminals —
                             for a studio that Claude Code already drives,
                             such as one shown in Claude Code's preview.
  --no-window                (packaged app) Run the studio with no window or
                             Dock icon — for a launcher that shows it
                             somewhere else, such as Claude Code's preview
                             pane. The studio prints its URL and runs until
                             the launcher stops it.
  -h, --help                 Show this help.

Set by launchers:
  --electron                 (npm run dev:electron) Show the studio in a
                             desktop window.
  --app-url <url>            (Electron window) Show this running studio.
  --mcp                      (the Claude Code plugin) Talk MCP on stdin and
                             stdout, with no window until studio_start asks
                             for one.
  --no-auto-commit           (Claude Code's studio from source) Git commits
                             default to off, as in every studio Claude Code
                             starts; the user's own "Commit changes to git"
                             switch still wins.
  --alongside                (Claude Code's studio from source) Open the
                             library even though another studio has it open
                             — only when the user chose a second studio.

Paths can start with ~. Relative paths are resolved from the folder you run
the command in.
`;

const VALUE_FLAGS = new Set(["open", "library", "export", "app-url"]);
const SWITCHES = new Set([
  "help",
  "electron",
  "mcp",
  "no-terminal",
  "no-window",
  "no-auto-commit",
  "alongside",
]);
/* The choices studio_start makes, which --mcp therefore can't take. */
const NOT_WITH_MCP = ["open", "new", "export", "electron", "app-url", "no-window"];

const isDirectory = (dir) => {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

const holdsShowcases = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true }).some(
      (entry) => entry.isDirectory() && existsSync(path.join(dir, entry.name, "showcase.yaml")),
    );
  } catch {
    return false;
  }
};

/** A path someone typed: a leading ~ is their home folder, and a relative
 *  path resolves against `cwd`. */
export function resolvePath(value, { cwd = process.cwd(), home = homedir() } = {}) {
  const expanded =
    value === "~" ? home : /^~[/\\]/.test(value) ? path.join(home, value.slice(2)) : value;
  return path.resolve(cwd, expanded);
}

/** The library `dir` belongs to: `dir` itself when it holds showcases or
 *  has library settings, its parent when it is one showcase, otherwise
 *  undefined. */
export function findLibrary(dir) {
  if (!isDirectory(dir)) return undefined;
  if (holdsShowcases(dir) || hasLibrarySettings(dir)) return dir;
  if (existsSync(path.join(dir, "showcase.yaml"))) return path.dirname(dir);
  return undefined;
}

/** libraryForClaude's rule in words, for studio_start's description. */
export const LIBRARY_FOR_CLAUDE_HELP =
  "the folder Claude Code runs in, when it holds showcases, is one, or is empty; or a " +
  "showcases folder inside it that holds showcases. When it holds other files, or is the " +
  "home folder, studio_start asks for this instead";

/** The library for a studio that Claude Code starts in `dir`, the folder
 *  Claude Code runs in. It never falls back to a folder the user didn't
 *  point at (the app's last folder, or ~/Showcases): a Claude Code session
 *  works in one folder, and that's where the user looks for new work.
 *
 *  Returns `{ library, reason }` when the choice is clear, where `reason`
 *  says in words why that folder. Returns `{ ask }` when the user has to
 *  choose — `ask` is `{ folder, why, suggested }`, where `why` is "home"
 *  (the home folder, or the top of a disk) or "other files" (a folder with
 *  things in it but no showcases), and `suggested` is a `showcases`
 *  folder inside it.
 *
 *    dir holds showcases                 → dir
 *    dir is one showcase                 → the folder above it
 *    dir has .studio/ (set up before)    → dir
 *    dir/showcases holds showcases, or
 *    has .studio/ (set up before)        → dir/showcases
 *    dir is the home folder or a disk    → ask
 *    dir is empty (dot files aside)      → dir
 *    anything else                       → ask */
export function libraryForClaude(dir, { home = homedir() } = {}) {
  const here = "the folder Claude Code runs in";
  const found = findLibrary(dir);
  if (found === dir) return { library: dir, reason: `${here}, which holds showcases` };
  if (found) return { library: found, reason: `the folder above ${here}, which is a showcase` };
  if (isDirectory(path.join(dir, ".studio"))) {
    return { library: dir, reason: `${here}, set up as a showcases folder before` };
  }
  const entries = listFolder(dir);
  /* Matched without regard to case: macOS and Windows would find
   * ~/Showcases under either spelling, so use the one on disk. */
  const sub = entries.find((entry) => entry.isDirectory() && /^showcases$/i.test(entry.name));
  if (sub) {
    const subDir = path.join(dir, sub.name);
    if (holdsShowcases(subDir) || isDirectory(path.join(subDir, ".studio"))) {
      return { library: subDir, reason: `the ${sub.name} folder inside ${here}` };
    }
  }
  const suggested = path.join(dir, sub?.name ?? "showcases");
  const resolved = path.resolve(dir);
  if (resolved === path.resolve(home) || resolved === path.parse(resolved).root) {
    return { ask: { folder: dir, why: "home", suggested } };
  }
  if (entries.every((entry) => entry.name.startsWith("."))) {
    return { library: dir, reason: `${here}, which is empty` };
  }
  return { ask: { folder: dir, why: "other files", suggested } };
}

const listFolder = (dir) => {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

/** Parses argv into the studio's options:
 *  `{ help, electron, mcp, terminal, autoCommit, window, showcasesDir, lock, exportJob,
 *  appUrl, unknown }`.
 *  `showcasesDir` is `defaultDir` unless --library, --open or --new picks
 *  one. Throws with a plain message when an option is misused or names a
 *  folder that won't work. */
export function studioOptions(argv, { cwd, defaultDir, home } = {}) {
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
    mcp: given.has("mcp"),
    terminal: !given.has("no-terminal"),
    autoCommit: !given.has("no-auto-commit"),
    alongside: given.has("alongside"),
    window: !given.has("no-window"),
    showcasesDir: defaultDir,
    lock: null,
    exportJob: undefined,
    appUrl: undefined,
    unknown,
  };
  if (options.help) return options;

  const resolve = (value) => resolvePath(value, { cwd, home });
  const folder = (value) => {
    const dir = resolve(value);
    if (!isDirectory(dir)) throw new Error(`${dir} is not a folder.`);
    return dir;
  };

  if (options.mcp) {
    const clashing = NOT_WITH_MCP.filter((name) => given.has(name));
    if (clashing.length) {
      throw new Error(
        `--mcp takes its choices from the studio_start tool, so it can't be used with ${clashing
          .map((name) => `--${name}`)
          .join(" or ")}.`,
      );
    }
  }
  if (given.has("open") && given.has("new")) throw new Error("Use --open or --new, not both.");
  if (given.has("open") && given.has("library")) {
    throw new Error("--open already picks the library: the showcase folder's parent.");
  }
  if (given.get("new") && given.has("library")) {
    throw new Error("Give the library once: --new <folder> or --library <folder>.");
  }

  if (given.has("library")) options.showcasesDir = folder(given.get("library"));

  if (given.has("open")) {
    const dir = resolve(given.get("open"));
    if (!isDirectory(dir) || !existsSync(path.join(dir, "showcase.yaml"))) {
      throw new Error(`${dir} is not a showcase folder: it has no showcase.yaml.`);
    }
    /* An older library can keep its settings in a root showcase.yaml
     * (server/library-config.mjs), so a showcase.yaml alone doesn't prove
     * this is one showcase. */
    if (holdsShowcases(dir) || hasLibrarySettings(dir)) {
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

  if (given.has("no-window") && (given.has("electron") || given.has("app-url"))) {
    throw new Error(
      "--no-window runs the packaged app without its window; it has no meaning here.",
    );
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
