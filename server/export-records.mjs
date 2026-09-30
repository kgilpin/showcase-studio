/* The studio's record of its video exports — full quality and draft —
 * so the Share page and Claude know whether the video on disk still
 * matches the showcase, and about how long a new one takes.
 *
 * Each export gets one small JSON file, written once:
 *
 *   <library>/.studio/exports/<showcase>/<record id>.json
 *     { id, showcaseId, kind, file, bytes, mtimeMs, durationMs,
 *       frames, renderMs, fingerprint, appVersion, createdAt }
 *
 * One file per record means nothing is ever read, changed and written
 * back, so two writers can't lose each other's work, and no lock is
 * needed. Each file is written under a temporary name and renamed into
 * place (writeRecordFile), so a reader never sees half of one.
 *
 * The fingerprint covers what the video was made from — showcase.yaml
 * (without its publish: block, which only holds the post's text), the
 * theme and any theme it extends, every file in assets/ and graphics/
 * (name, size and modified time), and the app version. It is taken when
 * the export starts, so an edit made while it renders makes it stale.
 *
 * The videos themselves stay in the export folder (Downloads). A newer
 * export moves the older file into history/, numbered (export-output.mjs), so
 * a record finds its file by size and modified time — which a rename
 * keeps — and a record whose file is gone is removed. */
import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import { VIDEO_FORMATS } from "../src/lib/export-kinds.mjs";
import { HISTORY_DIR, numberedCopies } from "./export-output.mjs";

/** The export kinds the studio keeps records of: the videos. */
export const RECORDED_KINDS = ["video", "video-draft", "video-43", "video-43-draft"];

/* How long one frame takes to capture and encode, before this studio has
 * an export of its own to measure. Measured from source (npm run dev,
 * Google Chrome) on an Apple Silicon Mac, 2026-09-30: a 61-second
 * showcase's draft (729 frames) took about 1¾ minutes, and its full
 * export captured at about 165 ms a frame before encoding. Capturing a
 * frame costs about the same at either size, so a draft is quicker mostly
 * because it has fewer frames (12 fps instead of 30). */
const DEFAULT_MS_PER_FRAME = {
  video: 180,
  "video-draft": 145,
  "video-43": 180,
  "video-43-draft": 145,
};

/** About how long a new export of `kind` takes for a showcase that runs
 *  `durationMs`: its frame count times the time per frame this studio's
 *  newest export of that kind took (renderMs / frames), or a measured
 *  default before there is one. */
export function exportEstimateMs(kind, durationMs, records = []) {
  const fps = VIDEO_FORMATS[kind]?.fps ?? 30;
  const frames = Math.round((durationMs / 1000) * fps);
  const measured = records.find((r) => r.kind === kind && r.renderMs > 0 && r.frames > 0);
  const perFrame = measured
    ? measured.renderMs / measured.frames
    : (DEFAULT_MS_PER_FRAME[kind] ?? 150);
  return Math.round(frames * perFrame);
}

const RECORDS_DIR = path.join(".studio", "exports");

const hash = (value) => createHash("sha256").update(value).digest("hex");

/** Writes a record file whole: to a hidden temporary name first, then
 *  renamed over the final name, so a reader sees the old file or the new
 *  one and never part of either. */
export function writeRecordFile(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`,
  );
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n");
  renameSync(temp, file);
}

/** Every record in `dir`, newest first; files that aren't records
 *  (a temporary file, broken JSON) are skipped. */
export function readRecordFiles(dir) {
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith("."));
  } catch {
    return [];
  }
  const records = [];
  for (const name of names) {
    try {
      records.push({ ...JSON.parse(readFileSync(path.join(dir, name), "utf8")), _path: name });
    } catch {
      /* A record being replaced, or one somebody broke: skip it. */
    }
  }
  return records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}

/** A record id that sorts by time: "20260930T142501123Z-video-3fa2". */
export function recordId(kind, now = new Date()) {
  const stamp = now.toISOString().replace(/[-:.]/g, "");
  return `${stamp}-${kind}-${randomBytes(2).toString("hex")}`;
}

const badId = (id) => !id || id !== path.basename(id) || id.startsWith(".");

function stamps(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith("."))
    .sort()
    .map((name) => {
      const { size, mtimeMs } = statSync(path.join(dir, name));
      return [name, size, Math.round(mtimeMs)];
    });
}

/** The fingerprint of what a showcase's video is made from (see the top
 *  of this file). Two calls agree exactly when a new export would draw
 *  the same video. */
export function exportFingerprint(showcasesDir, showcaseId, { appVersion } = {}) {
  const folder = path.join(showcasesDir, showcaseId);
  const doc = parse(readFileSync(path.join(folder, "showcase.yaml"), "utf8")) ?? {};
  delete doc.publish;
  const themes = [];
  const seen = new Set();
  for (let id = showcaseId; id && !seen.has(id);) {
    seen.add(id);
    const file = path.join(showcasesDir, id, "theme.yaml");
    const theme = existsSync(file) ? readFileSync(file, "utf8") : "";
    themes.push([id, theme]);
    try {
      id = theme ? parse(theme)?.extends : undefined;
    } catch {
      id = undefined;
    }
  }
  return hash(
    JSON.stringify({
      appVersion: appVersion ?? null,
      showcase: doc,
      themes,
      assets: stamps(path.join(folder, "assets")),
      graphics: stamps(path.join(folder, "graphics")),
    }),
  );
}

/** How long the showcase runs, in ms — the video's length. */
export function showcaseDurationMs(showcasesDir, showcaseId) {
  const doc = parse(readFileSync(path.join(showcasesDir, showcaseId, "showcase.yaml"), "utf8"));
  return (doc?.scenes ?? []).reduce(
    (sum, scene) => sum + resolveSceneTiming(scene, doc.meta?.pace).durationMs,
    0,
  );
}

/** Where a record's video is now: its own path while it is still the
 *  same file, else the numbered name in history/ a newer export moved it
 *  to (same size and modified time), else undefined. */
export function locateExport(record) {
  const same = (file) => {
    try {
      const { size, mtimeMs } = statSync(file);
      return size === record.bytes && Math.round(mtimeMs) === record.mtimeMs;
    } catch {
      return false;
    }
  };
  if (same(record.file)) return record.file;
  const dir = path.dirname(record.file);
  const ext = path.extname(record.file);
  const stem = path.basename(record.file, ext);
  return [
    ...numberedCopies(path.join(dir, HISTORY_DIR), stem, ext),
    ...numberedCopies(dir, stem, ext),
  ].find(same);
}

/** The export records of one library. */
export function createExportRecords({ getLibrary, appVersion }) {
  const dirFor = (showcaseId) => path.join(getLibrary(), RECORDS_DIR, showcaseId);

  return {
    /** The fingerprint a new export of the showcase would get now. */
    fingerprint: (showcaseId) => exportFingerprint(getLibrary(), showcaseId, { appVersion }),

    /** Records a finished export. `fingerprint` is the one taken when it
     *  started; `frames` and `renderMs` (how long it took) feed the next
     *  export's time estimate. */
    add({ showcaseId, kind, file, fingerprint, durationMs, frames, renderMs, now = new Date() }) {
      const { size, mtimeMs } = statSync(file);
      const record = {
        id: recordId(kind, now),
        showcaseId,
        kind,
        file,
        bytes: size,
        mtimeMs: Math.round(mtimeMs),
        durationMs,
        ...(frames ? { frames } : {}),
        ...(renderMs ? { renderMs } : {}),
        fingerprint,
        appVersion: appVersion ?? null,
        createdAt: now.toISOString(),
      };
      writeRecordFile(path.join(dirFor(showcaseId), `${record.id}.json`), record);
      return record;
    },

    /** The showcase's exports whose files are still there, newest first,
     *  each with `file` pointing where the video is now and `current`
     *  saying whether it matches the showcase. A record whose file is
     *  gone is removed. */
    list(showcaseId) {
      if (badId(showcaseId)) return [];
      const dir = dirFor(showcaseId);
      const now = existsSync(path.join(getLibrary(), showcaseId, "showcase.yaml"))
        ? exportFingerprint(getLibrary(), showcaseId, { appVersion })
        : null;
      const found = [];
      for (const { _path, ...record } of readRecordFiles(dir)) {
        const file = locateExport(record);
        if (!file) {
          try {
            unlinkSync(path.join(dir, _path));
          } catch {
            /* Already gone. */
          }
          continue;
        }
        found.push({ ...record, file, current: record.fingerprint === now });
      }
      return found;
    },

    /** About how long a new export of `kind` takes for a showcase that
     *  runs `durationMs`, measured by this library's newest export of that
     *  kind, of any showcase (exportEstimateMs). */
    estimateMs(kind, durationMs) {
      const root = path.join(getLibrary(), RECORDS_DIR);
      let ids = [];
      try {
        ids = readdirSync(root).filter((id) => !badId(id));
      } catch {
        /* No exports yet. */
      }
      const all = ids
        .flatMap((id) => readRecordFiles(path.join(root, id)))
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return exportEstimateMs(kind, durationMs, all);
    },

    /** One record by id, located as list() does; undefined when there is
     *  no such record or its file is gone. */
    get(showcaseId, id) {
      if (badId(showcaseId) || badId(id)) return undefined;
      return this.list(showcaseId).find((record) => record.id === id);
    },
  };
}
