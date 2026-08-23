/* The desktop shell's bridge (electron/preload.cjs). In the browser this
 * is absent and the app behaves as a plain web app; inside the studio,
 * window.showcaseStudio offers native abilities like exports. */

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
  | { field: "media.asset"; value: string; mediaKind?: "image" | "video" | undefined }
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
