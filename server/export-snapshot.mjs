/* A snapshot of one showcase for the length of an export (issue #29).
 *
 * A video export renders the record page frame by frame for minutes,
 * and meanwhile the showcase can change: a build rewrites the clips and
 * the durationMs pins, a Claude session edits a caption, the user types
 * a title. The page the exporter drives would re-read those (the
 * "showcase-changed" event), and the video would be two cuts spliced
 * together, or fail outright when the page's hook is gone for a moment.
 *
 * So an export renders from a copy taken when it starts:
 *
 *   <library>/.studio/snapshots/<pid>-<job>/     a library with one showcase
 *     <showcase>/showcase.yaml, theme.yaml         copies
 *     <showcase>/assets/*, graphics/*              copies that share the
 *                                                  file's blocks where the
 *                                                  file system can (APFS,
 *                                                  btrfs, XFS): instant, and
 *                                                  untouched by a later
 *                                                  write to the original,
 *                                                  in place or by rename
 *     <extended>/showcase.yaml, theme.yaml         the showcases this one's
 *                                                  theme extends, text only
 *
 * The studio serves it at /showcase-data-snapshot/<id>/ with the same
 * code that serves the library, the record page opens with
 * ?snapshot=<id> and reads from there (src/content/source.ts), and the
 * folder goes when the job
 * ends. The export's fingerprint is taken from the snapshot, so the
 * Share page still says, correctly, when the finished video no longer
 * matches the showcase. Only video exports use a snapshot: screens and
 * script exports and the page tools render the live library.
 *
 * The id carries the studio's pid: two studios on one library
 * (--alongside) each clear only the snapshots of studios that are gone. */
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { parse } from "yaml";

export const SNAPSHOTS_DIR = path.join(".studio", "snapshots");

/** Where a library's snapshots live. */
export function snapshotsRoot(showcasesDir) {
  return path.join(showcasesDir, SNAPSHOTS_DIR);
}

/** A snapshot id: this studio's pid and the job's id, which is also what
 *  the URL carries. */
export function snapshotId(jobId, pid = process.pid) {
  return `${pid}-${String(jobId).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/** Whether a string is a snapshot id this module could have made: what
 *  the URL route accepts before it touches the file system. */
export const isSnapshotId = (id) => /^[0-9]+-[A-Za-z0-9_-]+$/.test(String(id ?? ""));

/** Takes the snapshot: `dir` is the one-showcase library to render from,
 *  `remove` deletes it. A snapshot of the same id is replaced. */
export function takeSnapshot(showcasesDir, showcaseId, id) {
  if (!isSnapshotId(id)) throw new Error(`Not a snapshot id: "${id}"`);
  const source = path.join(showcasesDir, showcaseId);
  if (!existsSync(path.join(source, "showcase.yaml"))) {
    throw new Error(`No showcase named "${showcaseId}" in the library`);
  }
  const dir = path.join(snapshotsRoot(showcasesDir), id);
  rmSync(dir, { recursive: true, force: true });
  copyShowcase(source, path.join(dir, showcaseId), { files: true });
  /* The theme chain: a theme that extends another showcase's needs that
   * showcase loaded too, its text only. */
  const seen = new Set([showcaseId]);
  for (let next = themeExtends(source); next && !seen.has(next);) {
    seen.add(next);
    const from = path.join(showcasesDir, next);
    if (!existsSync(path.join(from, "showcase.yaml"))) break;
    copyShowcase(from, path.join(dir, next), { files: false });
    next = themeExtends(from);
  }
  return { id, dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

/** The folder of a snapshot by id, or undefined when there is none. */
export function snapshotDir(showcasesDir, id) {
  if (!isSnapshotId(id)) return undefined;
  const dir = path.join(snapshotsRoot(showcasesDir), id);
  return existsSync(dir) ? dir : undefined;
}

/** Removes the snapshots of studios that are no longer running: what a
 *  studio that stopped mid-export left behind. Another studio's, on the
 *  same library, stay. */
export function clearSnapshots(showcasesDir, { isRunning = processRuns } = {}) {
  const root = snapshotsRoot(showcasesDir);
  if (!existsSync(root)) return [];
  const removed = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pid = Number(/^(\d+)-/.exec(entry.name)?.[1]);
    if (pid && pid !== process.pid && isRunning(pid)) continue;
    rmSync(path.join(root, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return removed;
}

function processRuns(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function themeExtends(folder) {
  const file = path.join(folder, "theme.yaml");
  if (!existsSync(file)) return undefined;
  try {
    const value = parse(readFileSync(file, "utf8"))?.extends;
    return typeof value === "string" && value ? value : undefined;
  } catch {
    return undefined;
  }
}

function copyShowcase(from, to, { files }) {
  mkdirSync(to, { recursive: true });
  for (const name of ["showcase.yaml", "theme.yaml"]) {
    if (existsSync(path.join(from, name))) clone(path.join(from, name), path.join(to, name));
  }
  if (!files) return;
  for (const folder of ["assets", "graphics"]) {
    const src = path.join(from, folder);
    if (!existsSync(src)) continue;
    mkdirSync(path.join(to, folder), { recursive: true });
    for (const entry of readdirSync(src, { withFileTypes: true })) {
      if (!entry.isFile() || entry.name.startsWith(".")) continue;
      clone(path.join(src, entry.name), path.join(to, folder, entry.name));
    }
  }
}

/** A copy that shares the original's blocks where the file system can,
 *  and a plain copy elsewhere. Not a hard link: showcase.yaml and the
 *  words file are written in place, and a link would see the write. */
function clone(from, to) {
  copyFileSync(from, to, constants.COPYFILE_FICLONE);
}
