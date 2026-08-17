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

export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: Record<string, unknown> }
  | { type: "done" }
  | { type: "error"; message: string };

export type StudioAgent = {
  status(): Promise<{ hasKey: boolean; model: string }>;
  setKey(key: string): Promise<{ ok: boolean; error?: string }>;
  clearKey(): Promise<{ ok: boolean }>;
  reset(): Promise<{ ok: boolean }>;
  send(text: string): Promise<{ ok: boolean; error?: string }>;
  onEvent(callback: (event: AgentEvent) => void): () => void;
};

export type StudioTerminal = {
  /** Whether the PTY host loaded and Claude Code is installed. */
  available(): Promise<{ ptyReady: boolean; claude: boolean }>;
  /** Starts a session in the showcases folder — Claude Code when
   *  installed, a plain login shell otherwise. */
  start(size: {
    cols: number;
    rows: number;
  }): Promise<{ ok: boolean; claude?: boolean; error?: string }>;
  stop(): Promise<{ ok: boolean }>;
  input(data: string): void;
  resize(size: { cols: number; rows: number }): void;
  onData(callback: (data: string) => void): () => void;
  onExit(callback: (code: number) => void): () => void;
};

export type ShowcaseStudio = {
  /** Exports App Store screenshots; resolves to the output folder. */
  exportScreens(showcaseId: string): Promise<string>;
  /** Renders the showcase to an MP4; resolves to the output file. */
  exportVideo(showcaseId: string): Promise<string>;
  onExportProgress(callback: (progress: StudioExportProgress) => void): () => void;
  /** The BYOK Claude agent that edits the showcases folder. */
  agent: StudioAgent;
  /** The embedded terminal running the user's own Claude Code. */
  terminal: StudioTerminal;
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
