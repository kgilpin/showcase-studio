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

export type ShowcaseStudio = {
  /** Exports App Store screenshots; resolves to the output folder. */
  exportScreens(showcaseId: string): Promise<string>;
  /** Renders the showcase to an MP4; resolves to the output file. */
  exportVideo(showcaseId: string): Promise<string>;
  onExportProgress(callback: (progress: StudioExportProgress) => void): () => void;
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
