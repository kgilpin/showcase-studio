/* The studio client: how the page reaches the studio server
 * (server/studio-server.mjs). It is the same in every mode — a browser on
 * `npm run dev`, the Electron window, the Claude Code preview, the
 * packaged app — because each of them loads the page from a studio. On a
 * plain web build (showcases bundled into the app) no studio serves the
 * page, so studio() is undefined and the app is just a player.
 *
 * The Electron window adds one thing a browser can't have: the real path
 * of a dropped file (window.showcaseStudioShell, electron/preload.cjs). */
import { useMemo, useSyncExternalStore } from "react";
import type { DestinationId, PostedText, PublishField } from "@/content/publish-rules.mjs";
import type { PlayerView } from "./export-kinds.mjs";
import { isCapturePage, type WindowLock } from "./window-lock.mjs";

/** One export job, as the studio reports it (server/export-jobs.mjs). */
export type StudioExportJob = {
  jobId: string;
  kind: string;
  showcaseId: string;
  status: "running" | "done" | "failed" | "canceled";
  /** What the exporter is doing: "frame 13/26 (1s)", "encoding 26 frames…". */
  progress: string;
  /** Present while there is something to count (frames, screenshots). */
  step?: number;
  steps?: number;
  /** The finished file or folder. */
  out?: string;
  error?: string;
};

export type StudioExports = {
  /** Starts an export; fails when one is already running. */
  start(
    kind: string,
    showcaseId: string,
  ): Promise<{ ok: boolean; job?: StudioExportJob; error?: string }>;
  cancel(jobId: string): Promise<{ ok: boolean; job?: StudioExportJob; error?: string }>;
  /** Opens the file manager on a finished job's output, or on the
   *  showcase's export folder. */
  reveal(payload: {
    showcaseId: string;
    jobId?: string;
  }): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Every change to any job, whoever started it (the page or Claude). */
  onChange(callback: (job: StudioExportJob) => void): () => void;
};

/** What the studio knows about the license (server/license.mjs):
 *  trial — no good license, freeLeft full-quality videos left;
 *  subscribed; payment — subscribed, but the last payment failed;
 *  waiting — a checkout is open in the browser. */
export type StudioLicense = {
  state: "trial" | "subscribed" | "payment" | "waiting";
  freeLeft: number;
  freeLimit: number;
  hasKey: boolean;
  /** A key is saved, but its subscription has ended. */
  ended: boolean;
  validUntil: string | null;
  renews: boolean;
  checkedAt: string | null;
};

type Done = { ok: boolean; error?: string };

export type StudioLicensing = {
  /** Asks the license service again (force: even if it asked recently). */
  refresh(force?: boolean): Promise<Done & { status?: StudioLicense }>;
  /** Opens a Stripe checkout in the browser and waits for it to be paid;
   *  the "license" event says when it is. */
  checkout(): Promise<Done>;
  cancelCheckout(): Promise<Done>;
  /** A key the user typed: saved only if its subscription is good. */
  enterKey(key: string): Promise<Done>;
  /** Opens Stripe's Customer Portal in the browser. */
  portal(): Promise<Done>;
  /** The license key saved on this computer, or null. */
  key(): Promise<string | null>;
  /** Takes the key off this computer; the subscription keeps running. */
  remove(): Promise<Done>;
};

/** What a finished media build reports (server/build-media.mjs). */
export type StudioBuildReport = {
  built: string[];
  unchanged: string[];
  notes: string[];
  totalMs: number;
  pins: Record<string, number>;
};

export type StudioBuilds = {
  /** Builds a showcase's media from its cut list; fails when one is
   *  already running. */
  start(
    showcaseId: string,
    options?: { force?: boolean },
  ): Promise<{ ok: boolean; job?: StudioExportJob; error?: string }>;
  cancel(jobId: string): Promise<{ ok: boolean; job?: StudioExportJob; error?: string }>;
};

export type StudioTerminal = {
  /** The filesystem path of a dropped File (only the desktop window knows
   *  it; a browser gives the file name). */
  pathForFile(file: File): string;
  /** Whether the PTY host loaded and Claude Code is installed. */
  available(): Promise<{ ptyReady: boolean; claude: boolean }>;
  /** Whether the showcase's integrated session is currently running. */
  status(options: { id: string }): Promise<{ running: boolean }>;
  /** Opens the showcase's Claude session in the system terminal instead. */
  external(options: { id: string }): Promise<{ ok: boolean; error?: string }>;
  /** Starts (or reattaches to) the showcase's persistent session, whose
   *  working directory is that showcase's folder — Claude Code when
   *  installed, a plain login shell otherwise. On reattach, `buffer`
   *  carries the scrollback to replay. */
  start(options: { id: string; cols: number; rows: number }): Promise<{
    ok: boolean;
    attached?: boolean;
    buffer?: string;
    claude?: boolean;
    error?: string;
  }>;
  stop(options: { id: string }): Promise<{ ok: boolean }>;
  input(payload: { id: string; data: string }): void;
  resize(payload: { id: string; cols: number; rows: number }): void;
  onData(callback: (payload: { id: string; data: string }) => void): () => void;
  onExit(callback: (payload: { id: string; code: number }) => void): () => void;
};

/* In-app editing writes exactly these fields and nothing else — a
 * deliberate whitelist (like the theme keys), not a generic YAML patch.
 * The studio server applies each edit to showcase.yaml with
 * comment-preserving targeted updates (server/edit-yaml.mjs). */
export type SceneEdit =
  | { field: "title"; value: string }
  | { field: "caption"; captionIndex: number; value: string }
  /** Structural caption edits: insert a line at captionIndex (the
   *  whole authored object, so a delete's inverse restores durations
   *  and word timings too), or remove one. */
  | {
      field: "caption.insert";
      captionIndex: number;
      caption: { text: string } & Record<string, unknown>;
    }
  | { field: "caption.delete"; captionIndex: number }
  /** Structural scene edits: insert a whole scene (the raw authored
   *  shape) at index, or remove the addressed scene. sceneId on insert
   *  is the new scene's id (payload.scene.id decides). Comments inside
   *  a deleted scene are not restored by undo. */
  | { field: "scene.insert"; index: number; scene: { id: string } & Record<string, unknown> }
  | { field: "scene.delete" }
  | { field: "media.asset"; value: string; mediaKind?: "image" | "video" | undefined }
  /** Replaces the scene's whole media mapping — the op behind swapping
   *  a TSX graphic for an asset (and back, as its own inverse). */
  | { field: "media.set"; media: { kind: string } & Record<string, unknown> }
  /** The scene's own TikTok fit (media.tiktok — how its picture goes
   *  into the 9:16 frame). null removes it, so the scene follows
   *  meta.tiktok and its fit/align again. */
  | {
      field: "media.tiktok";
      value: { fit?: "fill" | "fit"; focus?: string; bands?: "blur" | "color" } | null;
    }
  /** Showcase-wide overlay caption painting (meta; sceneId is ignored —
   *  pass ""). Empty value deletes, restoring the default. */
  | { field: "meta.captionStyle"; value: "" | "chip" | "karaoke" | "reveal" }
  /** Overlay captions on the 4:3 embed canvas (meta; sceneId is ignored —
   *  pass ""). null deletes, returning to the voiceover-based default. */
  | { field: "meta.set"; name: "embedCaptions"; value: boolean | null }
  /** The view the player opens the showcase in (meta.view; sceneId is
   *  ignored — pass ""). null deletes: the player opens in TikTok view. */
  | { field: "meta.set"; name: "view"; value: PlayerView | null }
  /** The text the video is posted with (showcase.yaml's publish: block;
   *  sceneId is ignored — pass ""): the default, or one destination's
   *  override. null or "" removes it, so it inherits again. */
  | {
      field: "publish.set";
      destination?: DestinationId | undefined;
      name: PublishField;
      value: string | string[] | null;
    }
  /** Style-panel edits to theme.yaml (sceneId is ignored — pass "").
   *  Whitelisted keys only (server/edit-theme.mjs); empty value deletes,
   *  restoring the default. */
  | { field: "theme"; group: "colors" | "atmosphere"; name: string; value: string };

/** `baseHash` names the target file's content the edit was made against
 *  (sha256 hex; showcase.yaml, or theme.yaml for theme edits); the studio
 *  refuses the write when the file no longer matches. */
export type SceneEditPayload = {
  showcaseId: string;
  sceneId: string;
  baseHash?: string | undefined;
} & SceneEdit;

/** What the studio says about itself (GET /studio/api/info). */
export type StudioInfo = {
  version: string;
  url: string | null;
  library: string;
  lock: WindowLock | null;
  /** airDrop: the studio can open macOS's AirDrop window (a Mac). */
  features: { terminal: boolean; airDrop?: boolean };
  /** From source only: the studio's own code files that changed since
   *  it started, which it keeps running until a restart
   *  (server/code-changes.mjs). */
  changedCode?: string[];
};

/** One recorded full-quality export (server/export-records.mjs). */
export type ShareExport = {
  id: string;
  showcaseId: string;
  kind: string;
  /** Where the video is now. */
  file: string;
  bytes: number;
  durationMs: number;
  /** How many frames it rendered, and how long that took. */
  frames?: number;
  renderMs?: number;
  createdAt: string;
  /** It matches the showcase as it is now. */
  current: boolean;
};

/** One export kind's records: the export that matches the showcase now,
 *  the newest one of any age, and about how long a new one takes. */
export type ShareExports = {
  current: ShareExport | null;
  latest: ShareExport | null;
  estimateMs: number;
};

/** One hand-off to a destination (server/share.mjs). */
export type ShareHandoff = {
  id: string;
  destination: DestinationId;
  method: "computer" | "phone" | "other";
  exportId?: string;
  /** Which export was posted: the full-quality video or the draft. */
  quality?: "full" | "draft";
  createdAt: string;
  postUrl?: string;
  postedAt?: string;
};

/** One destination's view of the showcase, as the studio resolves it. */
export type ShareDestination = {
  id: DestinationId;
  label: string;
  /** The phone app a post is made from ("YouTube" for a Short too). */
  app: string;
  uploadUrl: string;
  uploadHint: string;
  /** The full-quality export it takes: "video" (9:16) or "video-43". */
  exportKind: "video" | "video-43";
  /** What the platform calls the text box. */
  captionName: "caption" | "description";
  fields: PublishField[];
  /** seconds is unset for a destination that takes any length. */
  limits: { caption: number; title?: number; hashtags?: number; seconds?: number };
  text: PostedText;
  /** The caption box's text (the description on YouTube). */
  paste: string;
  problems: string[];
};

/** The Share page's data (the share-status action; share_status). */
export type ShareStatus = {
  showcaseId: string;
  /** showcase.yaml's content hash — the base for a publish.set edit. */
  version: string;
  title: string;
  /** How long the showcase runs. */
  durationMs: number;
  publish: Record<string, unknown> | null;
  /** By kind: video, video-draft, video-43, video-43-draft. */
  exports: Record<string, ShareExports>;
  destinations: ShareDestination[];
  handoffs: ShareHandoff[];
};

export type StudioShare = {
  status(showcaseId: string): Promise<{ ok: boolean; status?: ShareStatus; error?: string }>;
  /** Records a hand-off of a current export — the full-quality video,
   *  or the draft with quality "draft". "computer" also opens the upload
   *  page in the user's browser; "phone" opens the AirDrop window (a Mac
   *  only). */
  handOff(payload: {
    showcaseId: string;
    destination: DestinationId;
    method: "computer" | "phone";
    quality?: "full" | "draft";
  }): Promise<{ ok: boolean; handoff?: ShareHandoff; error?: string }>;
  /** Keeps a post's link with its hand-off. */
  postLink(payload: {
    showcaseId: string;
    destination: DestinationId;
    url: string;
    handoffId?: string;
  }): Promise<{ ok: boolean; handoff?: ShareHandoff; error?: string }>;
  /** Opens a hand-off's post link in the user's browser. */
  openPost(payload: {
    showcaseId: string;
    handoffId: string;
  }): Promise<{ ok: boolean; error?: string }>;
  /** Selects an export's video in Finder or Explorer. */
  reveal(payload: {
    showcaseId: string;
    exportId: string;
  }): Promise<{ ok: boolean; path?: string; error?: string }>;
  /** Copies text: with the browser's clipboard when it allows, else
   *  through the studio (an embedded preview may not allow it). */
  copy(text: string): Promise<boolean>;
  /** The URL the page plays an export's video from. */
  videoUrl(showcaseId: string, exportId: string): string;
};

/** The library's git history (GET /studio/api/history;
 *  server/showcase-history.mjs status()). */
export type StudioHistory = {
  /** The library is in a git repository, and git is installed. */
  git: boolean;
  /** Changes are being committed right now. */
  autoCommit: boolean;
  /** The user's choice: the "Commit changes to git" switch. */
  enabled: boolean;
  /** Commits can happen here at all (git, a repository, and a library
   *  .gitignore doesn't hide). When false, `reason` says why. */
  available: boolean;
  branch: string | null;
  root?: string;
  /** Why commits are off, impossible, or waiting. */
  reason?: string;
};

export type ShowcaseStudio = {
  info(): StudioInfo;
  /** The studio's lock from the --open / --new options, or null when it
   *  may switch showcases. */
  windowLock(): WindowLock | null;
  /** Exports: one at a time, shared with the MCP export tools. */
  exports: StudioExports;
  /** Media builds from a showcase's cut list: their own lane, so a
   *  build and an export don't block each other. */
  builds: StudioBuilds;
  /** The subscription: status, checkout, a typed key, the portal. */
  license: StudioLicensing;
  /** Per-showcase terminals running the user's own Claude Code. */
  terminal: StudioTerminal;
  /** Scaffolding for new showcases (the home page's "+" card). */
  showcases: {
    create(name: string): Promise<{ ok: boolean; id?: string; error?: string }>;
  };
  /** In-app editing: one whitelisted field edit on a scene's YAML.
   *  On success, `hash` is the written file's content hash — the next
   *  edit's base. */
  scenes: {
    edit(payload: SceneEditPayload): Promise<{ ok: boolean; hash?: string; error?: string }>;
  };
  /** Shares the script as a phone teleprompter: publishes the narration
   *  snapshot to the prompter site and returns the capability URL. The
   *  URL is stable per showcase folder — publishing again updates it in
   *  place. `replaced` is true when the old link couldn't be updated (it
   *  expired) and this is a new one to send. */
  prompter: {
    publish(
      showcaseId: string,
    ): Promise<{ ok: boolean; url?: string; replaced?: boolean; error?: string }>;
  };
  /** The studio's git history, and the switch that turns commits on
   *  and off (studio-wide, in effect at once). */
  history: {
    status(): Promise<StudioHistory | null>;
    setAutoCommit(on: boolean): Promise<{ ok: boolean; history?: StudioHistory; error?: string }>;
  };
  /** Getting the video onto TikTok, Instagram and YouTube Shorts (the
   *  Share page). */
  share: StudioShare;
  /** One frame of the video at a time, as the export would render it,
   *  to save as a PNG (the player's Frame button). `name` is the file
   *  name the studio suggests. */
  frame(
    showcaseId: string,
    options: { atMs: number; view: "tiktok" | "43"; safeArea: boolean },
  ): Promise<{ ok: true; blob: Blob; name: string } | { ok: false; error: string }>;
  /** Asset-collection operations (the assets page). */
  assets: {
    /** Renames an asset file and updates the showcase.yaml references
     *  (asset:/src:/cover: fields, bare and full-name forms). */
    rename(payload: { showcaseId: string; from: string; to: string }): Promise<{
      ok: boolean;
      name?: string;
      updatedReferences?: number;
      error?: string;
    }>;
    /** Writes dropped files into the showcase's assets/ folder — all in
     *  one request, so the studio's reload can't interrupt a batch. Data
     *  is base64; colliding names are de-duplicated, never overwritten. */
    add(payload: {
      showcaseId: string;
      files: { name: string; data: string }[];
    }): Promise<{ ok: boolean; names?: string[]; error?: string }>;
    /** Deletes one asset file (the page confirms first). YAML
     *  references are left alone — a dangling key shows in the
     *  "referenced but missing" list. */
    remove(payload: { showcaseId: string; name: string }): Promise<{ ok: boolean; error?: string }>;
  };
};

declare global {
  interface Window {
    /** The studio client, for debugging and automated checks. */
    showcaseStudio?: ShowcaseStudio;
    /** The Electron window's extras (electron/preload.cjs). */
    showcaseStudioShell?: {
      pathForFile(file: File): string;
      /** Starts a drag of a file on disk out of the window, onto another
       *  app (an upload page in the browser). Only exports can be
       *  dragged. */
      startDrag?(file: string): void;
    };
  }
}

const API = "/studio/api";

/* A studio serves the page when the page loads its showcases from the
 * same server (a relative data URL). */
const servedByStudio = Boolean(
  (import.meta.env["VITE_SHOWCASES_URL"] as string | undefined)?.startsWith("/"),
);

/* ---------- studio events ---------- */

type Listener = (data: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

function on(event: string, listener: Listener): () => void {
  const set = listeners.get(event) ?? new Set<Listener>();
  listeners.set(event, set);
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

function dispatch(event: string, data: unknown) {
  for (const listener of [...(listeners.get(event) ?? [])]) listener(data);
}

const EVENTS = [
  "reload",
  "info",
  "code",
  "export",
  "build",
  "license",
  "terminal-data",
  "terminal-exit",
];

function followEvents() {
  const source = new EventSource(`${API}/events`);
  for (const name of EVENTS) {
    source.addEventListener(name, (event) =>
      dispatch(name, JSON.parse((event as MessageEvent<string>).data)),
    );
  }
}

let info: StudioInfo | null = null;
let client: ShowcaseStudio | undefined;

/* Files changed outside the studio (Claude, an editor, git): show them —
 * except on a page being drawn for a screenshot or video, where a reload
 * would break the capture. */
on("reload", () => {
  if (!isCapturePage(window.location.pathname, window.location.search)) {
    window.location.reload();
  }
});
/* Another library means the current page may not exist there: go home. */
/* The studio's own code changed on disk (from source): the page shows a
 * banner until the studio restarts (src/components/studio/CodeChangedBanner). */
let changedCode: string[] = [];
on("code", (data) => {
  changedCode = (data as { changed: string[] }).changed;
});
on("info", (data) => {
  const next = data as StudioInfo;
  const libraryChanged = info != null && info.library !== next.library;
  info = next;
  changedCode = next.changedCode ?? [];
  if (libraryChanged) window.location.assign("/");
});

/* ---------- requests ---------- */

async function post<T>(action: string, body?: unknown): Promise<T> {
  try {
    const response = await fetch(`${API}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return (await response.json()) as T;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) } as T;
  }
}

async function get<T>(name: string): Promise<T | null> {
  try {
    const response = await fetch(`${API}/${name}`);
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/* Keystrokes and resizes must arrive in order, so they go one request at
 * a time. */
let inOrder: Promise<unknown> = Promise.resolve();
function sendInOrder(action: string, body: unknown) {
  inOrder = inOrder.then(() => post(action, body));
}

/* ---------- exports ---------- */

/* The newest export job, kept current from the "export" events. A page
 * that loads mid-export — or reconnects after the studio restarts — asks
 * for it once (export-current), since events only report changes. */
let exportJob: StudioExportJob | null = null;

function setExportJob(job: StudioExportJob | null) {
  exportJob = job;
  dispatch("export-job", job);
}

on("export", (data) => setExportJob(data as StudioExportJob));
on("info", () => {
  void post<{ ok: boolean; job?: StudioExportJob | null }>("export-current").then((result) => {
    if (result.ok) setExportJob(result.job ?? null);
  });
});

function createExports(): StudioExports {
  return {
    start: (kind, showcaseId) => post("export", { kind, showcaseId }),
    cancel: (jobId) => post("export-cancel", { jobId }),
    reveal: (payload) => post("export-reveal", payload),
    onChange: (callback) => on("export", (data) => callback(data as StudioExportJob)),
  };
}

/** The newest export job (running, or the last to finish), for rendering;
 *  null before the first export and on a plain web build. */
export function useExportJob(): StudioExportJob | null {
  return useSyncExternalStore(
    (onChange) => on("export-job", onChange),
    () => exportJob,
    () => null,
  );
}

/* ---------- licensing ---------- */

/* What the pill and the export dialogs show, kept current from the
 * "license" events, plus one ask on connect. */
let license: StudioLicense | null = null;

function setLicense(next: StudioLicense | null) {
  license = next;
  dispatch("license-status", next);
}

on("license", (data) => setLicense(data as StudioLicense));
on("info", () => {
  void post<{ ok: boolean; status?: StudioLicense }>("license-status").then((result) => {
    if (result.ok && result.status) setLicense(result.status);
  });
});

function createLicensing(): StudioLicensing {
  return {
    refresh: async (force = false) => {
      const result = await post<Done & { status?: StudioLicense }>("license-status", {
        refresh: force,
      });
      if (result.ok && result.status) setLicense(result.status);
      return result;
    },
    checkout: () => post("license-checkout"),
    cancelCheckout: () => post("license-checkout-cancel"),
    enterKey: (key) => post("license-key", { key }),
    portal: () => post("license-portal"),
    key: async () => (await post<Done & { key?: string | null }>("license-key-get")).key ?? null,
    remove: () => post("license-remove"),
  };
}

/** The license as last heard; null before the first answer and on a
 *  plain web build. */
export function useLicense(): StudioLicense | null {
  return useSyncExternalStore(
    (onChange) => on("license-status", onChange),
    () => license,
    () => null,
  );
}

/* ---------- media builds ---------- */

/* The newest media build, kept current the same way as exports: the
 * "build" events, plus one ask on connect for a build already running. */
let buildJob: StudioExportJob | null = null;

function setBuildJob(job: StudioExportJob | null) {
  buildJob = job;
  dispatch("build-job", job);
}

on("build", (data) => setBuildJob(data as StudioExportJob));
on("info", () => {
  void post<{ ok: boolean; job?: StudioExportJob | null }>("build-current").then((result) => {
    if (result.ok) setBuildJob(result.job ?? null);
  });
});

function createBuilds(): StudioBuilds {
  return {
    start: (showcaseId, options) => post("build", { showcaseId, ...options }),
    cancel: (jobId) => post("build-cancel", { jobId }),
  };
}

/** The newest media build (running, or the last to finish). */
export function useBuildJob(): StudioExportJob | null {
  return useSyncExternalStore(
    (onChange) => on("build-job", onChange),
    () => buildJob,
    () => null,
  );
}

function createTerminal(enabled: boolean): StudioTerminal {
  return {
    pathForFile: (file) => window.showcaseStudioShell?.pathForFile(file) ?? file.name,
    available: () =>
      enabled ? post("terminal-available") : Promise.resolve({ ptyReady: false, claude: false }),
    status: (options) => post("terminal-status", options),
    external: (options) => post("terminal-external", options),
    start: (options) => post("terminal-start", options),
    stop: (options) => post("terminal-stop", options),
    input: (payload) => sendInOrder("terminal-input", payload),
    resize: (payload) => sendInOrder("terminal-resize", payload),
    onData: (callback) =>
      on("terminal-data", (data) => callback(data as { id: string; data: string })),
    onExit: (callback) =>
      on("terminal-exit", (data) => callback(data as { id: string; code: number })),
  };
}

function createShare(): StudioShare {
  return {
    status: (showcaseId) => post("share-status", { showcaseId }),
    handOff: (payload) => post("share-handoff", payload),
    postLink: (payload) => post("share-post-link", payload),
    reveal: (payload) => post("share-reveal", payload),
    openPost: (payload) => post("share-open-post", payload),
    copy: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return (await post<{ ok: boolean }>("share-copy", { text })).ok;
      }
    },
    videoUrl: (showcaseId, exportId) =>
      `${API}/export-video?${new URLSearchParams({ showcase: showcaseId, id: exportId })}`,
  };
}

/** GET /studio/api/frame: the PNG, or the studio's error. */
async function fetchFrame(
  showcaseId: string,
  { atMs, view, safeArea }: { atMs: number; view: "tiktok" | "43"; safeArea: boolean },
): Promise<{ ok: true; blob: Blob; name: string } | { ok: false; error: string }> {
  try {
    const query = new URLSearchParams({ showcase: showcaseId, at: String(Math.round(atMs)), view });
    if (safeArea) query.set("safeArea", "1");
    const response = await fetch(`${API}/frame?${query}`);
    if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? `The studio answered ${response.status}` };
    }
    const suggested = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "");
    return {
      ok: true,
      blob: await response.blob(),
      name: suggested?.[1] ?? `${showcaseId}-t${String(Math.round(atMs)).padStart(6, "0")}.png`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function createClient(first: StudioInfo): ShowcaseStudio {
  return {
    info: () => info ?? first,
    windowLock: () => info?.lock ?? null,
    exports: createExports(),
    builds: createBuilds(),
    license: createLicensing(),
    terminal: createTerminal(first.features.terminal),
    showcases: { create: (name) => post("showcase-create", { name }) },
    scenes: { edit: (payload) => post("scene-edit", payload) },
    prompter: { publish: (showcaseId) => post("prompter-publish", { showcaseId }) },
    share: createShare(),
    frame: fetchFrame,
    history: {
      status: () => get<StudioHistory>("history"),
      setAutoCommit: (on) => post("history-auto-commit", { on }),
    },
    assets: {
      rename: (payload) => post("asset-rename", payload),
      add: (payload) => post("asset-add", payload),
      remove: (payload) => post("asset-delete", payload),
    },
  };
}

/** Resolves once the page knows whether a studio serves it (and if so,
 *  what the studio says about itself). Immediate during SSR and on a
 *  plain web build. The root route waits for it before rendering. */
export const studioReady: Promise<void> =
  typeof window === "undefined" || !servedByStudio
    ? Promise.resolve()
    : fetch(`${API}/info`)
        .then((response) => (response.ok ? (response.json() as Promise<StudioInfo>) : null))
        .then((body) => {
          if (!body?.version) return;
          info = body;
          changedCode = body.changedCode ?? [];
          client = createClient(body);
          window.showcaseStudio = client;
          followEvents();
        })
        .catch(() => {});

/** The studio client, or undefined when no studio serves the page (and
 *  during SSR). */
export function studio(): ShowcaseStudio | undefined {
  return client;
}

/** The studio's lock (see src/lib/window-lock.mjs); null when the studio
 *  may switch showcases, and on a plain web build. */
export function windowLock(): WindowLock | null {
  return info?.lock ?? null;
}

const whenLockMayChange = (onChange: () => void) => {
  void studioReady.then(onChange);
  return on("info", onChange);
};

/** The studio's lock, for rendering. Server-rendered HTML has no studio,
 *  so it renders unlocked and hydration then switches to the real lock
 *  without a mismatch. Snapshots are compared as JSON so an equal lock
 *  never re-renders. */
export function useWindowLock(): WindowLock | null {
  const json = useSyncExternalStore(
    whenLockMayChange,
    () => JSON.stringify(windowLock()),
    () => "null",
  );
  return useMemo(() => JSON.parse(json) as WindowLock | null, [json]);
}

const whenCodeMayChange = (onChange: () => void) => {
  void studioReady.then(onChange);
  const offInfo = on("info", onChange);
  const offCode = on("code", onChange);
  return () => {
    offInfo();
    offCode();
  };
};

/** The studio's own code files that changed since it started, for
 *  rendering: empty until the studio says otherwise, in the packaged
 *  app, during SSR, and without a studio. Compared as JSON so an equal
 *  list never re-renders. */
export function useChangedCode(): string[] {
  const json = useSyncExternalStore(
    whenCodeMayChange,
    () => JSON.stringify(changedCode),
    () => "[]",
  );
  return useMemo(() => JSON.parse(json) as string[], [json]);
}
