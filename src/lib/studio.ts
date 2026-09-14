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
import { isCapturePage, type WindowLock } from "./window-lock.mjs";

export type StudioExportProgress = {
  showcaseId: string;
  kind: string;
  label: string;
  done?: boolean;
  out?: string;
  error?: string;
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
  /** Showcase-wide overlay caption painting (meta; sceneId is ignored —
   *  pass ""). Empty value deletes, restoring the default. */
  | { field: "meta.captionStyle"; value: "" | "chip" | "karaoke" | "reveal" }
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
  features: { terminal: boolean };
};

export type ShowcaseStudio = {
  info(): StudioInfo;
  /** The studio's lock from the --open / --new options, or null when it
   *  may switch showcases. */
  windowLock(): WindowLock | null;
  /** Exports App Store screenshots; resolves to the output folder. */
  exportScreens(showcaseId: string): Promise<string>;
  /** Renders the showcase to an MP4; resolves to the output file. */
  exportVideo(showcaseId: string): Promise<string>;
  onExportProgress(callback: (progress: StudioExportProgress) => void): () => void;
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
   *  URL is stable per showcase — publishing again updates it in place. */
  prompter: {
    publish(showcaseId: string): Promise<{ ok: boolean; url?: string; error?: string }>;
  };
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
    /** The Electron window's extra (electron/preload.cjs). */
    showcaseStudioShell?: { pathForFile(file: File): string };
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

const EVENTS = ["reload", "info", "export", "terminal-data", "terminal-exit"];

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
on("info", (data) => {
  const next = data as StudioInfo;
  const libraryChanged = info != null && info.library !== next.library;
  info = next;
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

/* Keystrokes and resizes must arrive in order, so they go one request at
 * a time. */
let inOrder: Promise<unknown> = Promise.resolve();
function sendInOrder(action: string, body: unknown) {
  inOrder = inOrder.then(() => post(action, body));
}

/** Starts an export job and resolves when the studio reports it done. */
function runExport(kind: "screens" | "video", showcaseId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stop = on("export", (data) => {
      const progress = data as StudioExportProgress;
      if (progress.showcaseId !== showcaseId || progress.kind !== kind || !progress.done) return;
      stop();
      if (progress.error) reject(new Error(progress.error));
      else resolve(progress.out ?? "");
    });
    void post<{ ok: boolean; error?: string }>("export", { kind, showcaseId }).then((result) => {
      if (result.ok) return;
      stop();
      reject(new Error(result.error ?? "The export didn't start"));
    });
  });
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

function createClient(first: StudioInfo): ShowcaseStudio {
  return {
    info: () => info ?? first,
    windowLock: () => info?.lock ?? null,
    exportScreens: (showcaseId) => runExport("screens", showcaseId),
    exportVideo: (showcaseId) => runExport("video", showcaseId),
    onExportProgress: (callback) => on("export", (data) => callback(data as StudioExportProgress)),
    terminal: createTerminal(first.features.terminal),
    showcases: { create: (name) => post("showcase-create", { name }) },
    scenes: { edit: (payload) => post("scene-edit", payload) },
    prompter: { publish: (showcaseId) => post("prompter-publish", { showcaseId }) },
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
