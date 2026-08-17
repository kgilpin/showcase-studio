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

export type ShowcaseStudio = {
  /** Exports App Store screenshots; resolves to the output folder. */
  exportScreens(showcaseId: string): Promise<string>;
  /** Renders the showcase to an MP4; resolves to the output file. */
  exportVideo(showcaseId: string): Promise<string>;
  onExportProgress(callback: (progress: StudioExportProgress) => void): () => void;
  /** Per-showcase terminals running the user's own Claude Code. */
  terminal: StudioTerminal;
  /** Showcases-folder actions (also in the system File menu). */
  folder: {
    /** Opens the folder picker; the app reloads on a new choice. */
    choose(): Promise<void>;
    /** Reveals the current showcases folder in the system file manager. */
    reveal(): Promise<void>;
  };
  /** Scaffolding for new showcases (the home page's "+" card). */
  showcases: {
    create(name: string): Promise<{ ok: boolean; id?: string; error?: string }>;
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
