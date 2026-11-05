/* The studio's own code, watched while the studio runs from source.
 *
 * Node loads a module once per process. In the studio from source
 * (npm run dev, and the one Claude Code starts), Vite serves the page
 * fresh code on every save, but the studio server — server/*.mjs and the
 * plain .mjs rule files under src/ it shares with the page — keeps
 * running what it loaded at the start. After a rule change the player
 * accepts a field the edit tool refuses, and nothing says why (issue
 * #18). This watches those files and keeps the list of the ones whose
 * content differs from the start: a save that changes nothing, and a
 * change put back, count as no change. The studio reports the list as
 * `changedCode`, the page shows a banner, and a restart clears it. The
 * packaged app ships no source, so it has nothing to watch. */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, watch } from "node:fs";
import path from "node:path";

/** The folders under the checkout that the running studio loads code
 *  from. */
const WATCHED = ["server", "src", "scripts"];
/** The scripts that start the studio; the other scripts are programs of
 *  their own. */
const START_SCRIPTS = ["dev.mjs", "dev-studio.mjs", "desktop-deps.mjs"];

/** True when `relative` (a path under the checkout, with / or \) is a
 *  file the running studio loaded: a server module, a plain ESM file
 *  under src/ (the rules the page shares with the server), or a script
 *  that starts the studio — never a test, a type file, or a page file
 *  (those Vite reloads). */
export function isStudioCodeFile(relative) {
  const parts = relative.split(/[/\\]/);
  const [top] = parts;
  const file = parts.at(-1);
  if (parts.length < 2 || !file.endsWith(".mjs") || file.endsWith(".test.mjs")) return false;
  if (top === "server" || top === "src") return true;
  return top === "scripts" && parts.length === 2 && START_SCRIPTS.includes(file);
}

/** A file's path under the checkout, with forward slashes on every
 *  platform, so the list reads the same everywhere. */
const relativeKey = (...parts) =>
  path
    .join(...parts)
    .split(path.sep)
    .join("/");

/** The content hash of `file`, or null when it isn't there. */
function hashOf(file) {
  try {
    return createHash("sha256").update(readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
}

/** Every studio code file under `srcDir`, as relative keys. */
function listCodeFiles(srcDir) {
  const files = [];
  for (const top of WATCHED) {
    const dir = path.join(srcDir, top);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const relative = relativeKey(path.relative(srcDir, path.join(entry.parentPath, entry.name)));
      if (isStudioCodeFile(relative)) files.push(relative);
    }
  }
  return files;
}

/**
 * Watches the studio's code under `srcDir` (the checkout) and calls
 * `onChange(files)` whenever the list of files that differ from the
 * start changes — the files' paths under the checkout, sorted, empty
 * once every change is put back. Changes settle for `settleMs` before
 * they are compared, so one save is one call. Returns
 * `{ changed(), close() }`: the list now, and a close that resolves once
 * the watchers have let go of the folders. `onError(message)` hears
 * about a folder that can't be watched.
 */
export function watchStudioCode(srcDir, { onChange, onError, settleMs = 250 } = {}) {
  const startHashes = new Map();
  for (const relative of listCodeFiles(srcDir)) {
    startHashes.set(relative, hashOf(path.join(srcDir, relative)));
  }
  const changed = new Set();
  const pending = new Set();
  let timer;
  const list = () => [...changed].sort();

  const settle = () => {
    let moved = false;
    for (const relative of pending) {
      /* A file that wasn't there at the start and isn't there now (a
       * created-and-deleted temp file) is no change. */
      const differs = hashOf(path.join(srcDir, relative)) !== (startHashes.get(relative) ?? null);
      if (differs !== changed.has(relative)) moved = true;
      if (differs) changed.add(relative);
      else changed.delete(relative);
    }
    pending.clear();
    if (moved) onChange?.(list());
  };

  const watchers = [];
  for (const top of WATCHED) {
    const dir = path.join(srcDir, top);
    if (!existsSync(dir)) continue;
    try {
      watchers.push(
        watch(dir, { recursive: true }, (_event, filename) => {
          if (filename == null) return;
          const relative = relativeKey(top, filename);
          if (!isStudioCodeFile(relative)) return;
          pending.add(relative);
          clearTimeout(timer);
          timer = setTimeout(settle, settleMs);
        }),
      );
    } catch (error) {
      onError?.(`${dir}: ${error.message}`);
    }
  }

  return {
    changed: list,
    async close() {
      clearTimeout(timer);
      /* fs.watch's close() returns before the handle is released; the
       * "close" event follows (a folder removed right after would still
       * be open on Windows). */
      await Promise.all(
        watchers.map((watcher) => {
          const closed = new Promise((resolve) => watcher.once("close", resolve));
          watcher.close();
          return closed;
        }),
      );
    },
  };
}
