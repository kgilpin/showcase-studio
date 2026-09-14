/* The desktop shell's bridge (electron/preload.cjs). In the browser this
 * is absent and the app behaves as a plain web app; inside the studio,
 * window.showcaseStudio offers native abilities like exports. */
import { useMemo, useSyncExternalStore } from "react";
import type { WindowLock } from "./window-lock.mjs";

export type StudioExportProgress = {
  showcaseId: string;
  kind: "screens" | "video";
  label: string;
  done?: boolean;
  out?: string;
};

export type StudioTerminal = {
  /** The filesystem path of a dropped File (renderer Files carry none). */
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
 * The main process applies each edit to showcase.yaml with
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
 *  (sha256 hex; showcase.yaml, or theme.yaml for theme edits); the shell
 *  refuses the write when the file no longer matches. */
export type SceneEditPayload = {
  showcaseId: string;
  sceneId: string;
  baseHash?: string | undefined;
} & SceneEdit;

export type ShowcaseStudio = {
  /** The window's lock from the --open / --new launch options, or null
   *  when the window may switch showcases. The shell enforces it; the
   *  page only hides switching controls and redirects early. */
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
     *  one call, so the watcher's reload can't interrupt a batch. Data
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
    showcaseStudio?: ShowcaseStudio;
  }
}

/** The studio bridge, or undefined in a plain browser (and during SSR). */
export function studio(): ShowcaseStudio | undefined {
  return typeof window === "undefined" ? undefined : window.showcaseStudio;
}

/* A browser viewing a headless studio has no bridge, so it asks the
 * studio's data server for the lock instead (<data URL>/studio.json).
 * Asked once per page load; a data server without the endpoint (the
 * vite middleware) answers 404, which means no lock. */
const dataUrl = import.meta.env["VITE_SHOWCASES_URL"] as string | undefined;
let serverLock: WindowLock | null = null;

/** Resolves once the lock is known. Immediate in the desktop window,
 *  during SSR, and when there is no data server. */
export const windowLockReady: Promise<void> =
  typeof window === "undefined" || window.showcaseStudio || !dataUrl
    ? Promise.resolve()
    : fetch(`${dataUrl.replace(/\/$/, "")}/studio.json`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { windowLock?: WindowLock | null } | null) => {
          serverLock = body?.windowLock ?? null;
        })
        .catch(() => {});

/** The window's lock (see src/lib/window-lock.mjs): from the bridge in
 *  the desktop window, from the data server in a browser. Null until
 *  windowLockReady resolves. */
export function windowLock(): WindowLock | null {
  const bridge = studio();
  return bridge ? (bridge.windowLock?.() ?? null) : serverLock;
}

const whenLockKnown = (onChange: () => void) => {
  void windowLockReady.then(onChange);
  return () => {};
};

/** The window's lock, for rendering. Server-rendered HTML has no bridge,
 *  so it renders unlocked and hydration then switches to the real lock
 *  without a mismatch. Snapshots are compared as JSON because the bridge
 *  returns a fresh object on every call. */
export function useWindowLock(): WindowLock | null {
  const json = useSyncExternalStore(
    whenLockKnown,
    () => JSON.stringify(windowLock()),
    () => "null",
  );
  return useMemo(() => JSON.parse(json) as WindowLock | null, [json]);
}
