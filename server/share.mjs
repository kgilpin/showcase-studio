/* Sharing a showcase's video to TikTok, Instagram and YouTube Shorts —
 * without the platforms' APIs. The studio gets everything ready and the
 * user posts on the platform's own upload page (or from their phone):
 *
 *   share status ─► is there a current export? (full quality — or the
 *                   draft, to try the steps without a long render)
 *                     no  ─► export it first (the export job lane)
 *                     yes ─► the destination's caption, hashtags and title
 *                            (showcase.yaml publish:, src/content/
 *                            publish-rules.mjs), with any problems
 *   hand-off     ─► "from this computer": open the upload page in the
 *                   user's browser; the user drags the video in and
 *                   pastes the caption
 *                   "to the phone": the desktop app's Share menu (AirDrop)
 *   post link    ─► the user pastes the post's URL back; it is kept with
 *                   the hand-off
 *
 * Each hand-off is one record file, like the export records
 * (export-records.mjs):
 *
 *   <library>/.studio/publishes/<showcase>/<record id>.json
 *     { id, showcaseId, destination, method, exportId, file,
 *       fingerprint, text, createdAt, postUrl?, postedAt? }
 *
 * Adding the post link rewrites that one record whole (writeRecordFile),
 * so a reader never sees half of it. */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import {
  captionWithHashtags,
  DESTINATION_IDS,
  DESTINATIONS,
  publishProblems,
  publishText,
} from "../src/content/publish-rules.mjs";
import { contentHash } from "./scene-edit.mjs";
import {
  readRecordFiles,
  recordId,
  showcaseDurationMs,
  writeRecordFile,
} from "./export-records.mjs";

const PUBLISHES_DIR = path.join(".studio", "publishes");

/** Which export a hand-off posts: the full-quality video, or the quick
 *  draft (half size, 12 fps) — good for trying the steps out without
 *  waiting for a full render. */
export const QUALITIES = ["full", "draft"];

const kindFor = (exportKind, quality) => (quality === "draft" ? `${exportKind}-draft` : exportKind);
const qualityOf = (kind) => (kind.endsWith("-draft") ? "draft" : "full");

/** How the video got to the platform: the user posted from this
 *  computer, sent it to their phone, or (a post link Claude was given)
 *  said nothing about it. */
export const HANDOFF_METHODS = ["computer", "phone", "other"];

/* The hosts each destination's posts live on, for checking a pasted
 * post link. */
const POST_HOSTS = {
  tiktok: ["tiktok.com"],
  instagram: ["instagram.com"],
  youtube: ["youtube.com", "youtu.be"],
};

const badId = (id) => !id || id !== path.basename(id) || id.startsWith(".");

/** The command that opens `url` in the user's default browser. */
export function openCommand(url, { platform = process.platform } = {}) {
  if (platform === "darwin") return ["open", [url]];
  if (platform === "win32") return ["explorer", [url]];
  return ["xdg-open", [url]];
}

/** Opens `url` in the user's default browser. Doesn't wait for it. */
export function openInBrowser(url) {
  const [command, args] = openCommand(url);
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

/** The commands that can put text on the system clipboard here, in the
 *  order to try them. */
export function clipboardCommands({ platform = process.platform } = {}) {
  if (platform === "darwin") return [["pbcopy", []]];
  if (platform === "win32") return [["clip", []]];
  return [
    ["wl-copy", []],
    ["xclip", ["-selection", "clipboard"]],
    ["xsel", ["--clipboard", "--input"]],
  ];
}

/** Puts `text` on the system clipboard. Resolves true when a clipboard
 *  command took it, false when none is installed (Linux without wl-copy,
 *  xclip or xsel) — the caller then shows the text instead. */
export async function copyToClipboard(text) {
  for (const [command, args] of clipboardCommands()) {
    const ok = await new Promise((resolve) => {
      const child = spawn(command, args, { stdio: ["pipe", "ignore", "ignore"] });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
      child.stdin.on("error", () => {});
      child.stdin.end(text);
    });
    if (ok) return true;
  }
  return false;
}

/** Checks a pasted post link: an http(s) URL on the destination's own
 *  site. Returns the URL as written, or throws with a plain message. */
export function checkPostUrl(destination, url) {
  let parsed;
  try {
    parsed = new URL(String(url ?? "").trim());
  } catch {
    throw new Error("That isn't a link — paste the post's address");
  }
  const host = parsed.hostname.toLowerCase();
  const hosts = POST_HOSTS[destination] ?? [];
  const onSite = hosts.some((site) => host === site || host.endsWith(`.${site}`));
  if (!/^https?:$/.test(parsed.protocol) || !onSite) {
    throw new Error(`A ${DESTINATIONS[destination].label} post link is on ${hosts.join(" or ")}`);
  }
  return parsed.toString();
}

/** What one destination would post now: its text, the text to paste, and
 *  any problems. */
function destinationStatus(id, publish, meta, { durationMs }) {
  const spec = DESTINATIONS[id];
  const text = publishText(publish, id, meta);
  return {
    id,
    label: spec.label,
    uploadUrl: spec.uploadUrl,
    uploadHint: spec.uploadHint,
    exportKind: spec.exportKind,
    fields: spec.fields,
    limits: {
      caption: spec.captionLimit,
      ...(spec.titleLimit ? { title: spec.titleLimit } : {}),
      ...(spec.maxHashtags ? { hashtags: spec.maxHashtags } : {}),
      seconds: spec.maxSeconds,
    },
    text,
    /* The caption box's text for TikTok and Instagram, and the
     * description for YouTube. */
    paste: captionWithHashtags(text, id),
    problems: publishProblems(id, text, { durationMs }),
  };
}

/** The Share page's data. `exportRecords` is the studio's
 *  createExportRecords(). */
export function createShare({ getLibrary, exportRecords }) {
  const dirFor = (showcaseId) => path.join(getLibrary(), PUBLISHES_DIR, showcaseId);

  const readShowcase = (showcaseId) => {
    if (badId(showcaseId)) throw new Error("Bad showcase id");
    const file = path.join(getLibrary(), showcaseId, "showcase.yaml");
    if (!existsSync(file)) throw new Error(`No showcase named "${showcaseId}"`);
    const yaml = readFileSync(file, "utf8");
    return { yaml, doc: parse(yaml) ?? {} };
  };

  const publishes = (showcaseId) =>
    readRecordFiles(dirFor(showcaseId)).map(({ _path, ...record }) => record);

  /** Everything the Share page shows for one showcase, and what
   *  share_status returns: the text for each destination, the exports —
   *  full quality and draft, each current or stale, with about how long a
   *  new one takes (`estimateMs`) — and the hand-offs made so far.
   *  `version` is showcase.yaml's content hash — the base for a
   *  publish.set edit. */
  function status(showcaseId) {
    const { yaml, doc } = readShowcase(showcaseId);
    const exports = exportRecords.list(showcaseId);
    const meta = doc.meta ?? {};
    const durationMs = showcaseDurationMs(getLibrary(), showcaseId);
    const byKind = (kind) => {
      const ofKind = exports.filter((record) => record.kind === kind);
      return {
        current: ofKind.find((record) => record.current) ?? null,
        latest: ofKind[0] ?? null,
        estimateMs: exportRecords.estimateMs(kind, durationMs),
      };
    };
    return {
      showcaseId,
      version: contentHash(yaml),
      title: meta.title ?? showcaseId,
      durationMs,
      publish: doc.publish ?? null,
      exports: Object.fromEntries(
        ["video", "video-draft", "video-43", "video-43-draft"].map((kind) => [kind, byKind(kind)]),
      ),
      destinations: DESTINATION_IDS.map((id) =>
        destinationStatus(id, doc.publish, meta, { durationMs }),
      ),
      handoffs: publishes(showcaseId),
    };
  }

  /** Records a hand-off of a current export to `destination`: the full
   *  quality video, or the draft when `quality` is "draft". Refuses when
   *  that export isn't current — the video on disk would not be the
   *  showcase as it is now. */
  function handOff({ showcaseId, destination, method, quality = "full", now = new Date() }) {
    if (!DESTINATIONS[destination]) throw new Error(`Unknown destination "${destination}"`);
    if (!HANDOFF_METHODS.includes(method)) {
      throw new Error(`method must be one of: ${HANDOFF_METHODS.join(", ")}`);
    }
    if (!QUALITIES.includes(quality)) {
      throw new Error(`quality must be one of: ${QUALITIES.join(", ")}`);
    }
    const { doc } = readShowcase(showcaseId);
    const spec = DESTINATIONS[destination];
    const kind = kindFor(spec.exportKind, quality);
    const video = exportRecords
      .list(showcaseId)
      .find((record) => record.kind === kind && record.current);
    if (!video) {
      throw new Error(
        `${showcaseId} has no current ${quality === "draft" ? "draft" : "full-quality"} video ` +
          `— export it first (kind "${kind}")`,
      );
    }
    const text = publishText(doc.publish, destination, doc.meta ?? {});
    const record = {
      id: recordId(destination, now),
      showcaseId,
      destination,
      method,
      exportId: video.id,
      quality: qualityOf(video.kind),
      file: video.file,
      fingerprint: video.fingerprint,
      text: {
        caption: text.caption,
        hashtags: text.hashtags,
        ...(text.title ? { title: text.title } : {}),
      },
      createdAt: now.toISOString(),
    };
    writeRecordFile(path.join(dirFor(showcaseId), `${record.id}.json`), record);
    return {
      record,
      video,
      paste: captionWithHashtags(text, destination),
      uploadUrl: spec.uploadUrl,
    };
  }

  /** Keeps a post's link with its hand-off: the one named by `handoffId`,
   *  else the newest hand-off to `destination` with no link yet, else a
   *  new record (method "other") for a post made some other way. */
  function recordPostUrl({ showcaseId, destination, url, handoffId, now = new Date() }) {
    readShowcase(showcaseId);
    const all = publishes(showcaseId);
    let record = handoffId ? all.find((r) => r.id === handoffId) : undefined;
    if (handoffId && !record) throw new Error(`No hand-off named "${handoffId}"`);
    const target = record?.destination ?? destination;
    if (!DESTINATIONS[target]) throw new Error(`Unknown destination "${target}"`);
    const postUrl = checkPostUrl(target, url);
    record ??= all.find((r) => r.destination === target && !r.postUrl);
    record = record
      ? { ...record, postUrl, postedAt: now.toISOString() }
      : {
          id: recordId(target, now),
          showcaseId,
          destination: target,
          method: "other",
          createdAt: now.toISOString(),
          postUrl,
          postedAt: now.toISOString(),
        };
    writeRecordFile(path.join(dirFor(showcaseId), `${record.id}.json`), record);
    return record;
  }

  /** One hand-off record by id, or undefined. */
  const handoff = (showcaseId, id) => {
    if (badId(showcaseId) || badId(id)) return undefined;
    return publishes(showcaseId).find((record) => record.id === id);
  };

  return { status, handOff, recordPostUrl, handoff };
}
