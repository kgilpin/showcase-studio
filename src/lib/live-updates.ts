/* Changes on disk, shown without a reload.
 *
 * The studio watches the library. When files inside one showcase's folder
 * change — its build wrote a new voiceover and new durations, Claude
 * edited showcase.yaml, someone saved it in an editor — it sends
 * "showcase-changed" naming the showcase, and this module re-reads that
 * showcase from the source and rebuilds it in place
 * (refreshShowcase in src/content/showcases.ts): the same path an in-app
 * edit takes, so the page keeps its state — the slide, the view, the
 * caption being typed. Before it reads, it waits for the page's own
 * edits still being written, so it can't fetch a file the newest edit
 * hasn't reached. Only what can't be absorbed this way — a showcase
 * added or removed, a source that can't re-read one showcase — reloads
 * the page, as a change to the library itself does ("reload" in
 * src/lib/studio.ts). Neither touches a page being drawn for a
 * screenshot or a video. */
import { refreshShowcase } from "@/content/showcases";
import { editsSettled, forgetEditBase } from "./edits";
import { onShowcaseChanged } from "./studio";
import { isCapturePage } from "./window-lock.mjs";

let following = false;
const refreshing = new Map<string, Promise<void>>();
const again = new Set<string>();

/** Starts following the studio's "showcase-changed" events; once per page. */
export function followLiveUpdates(): void {
  if (following || typeof window === "undefined") return;
  following = true;
  onShowcaseChanged(({ showcaseId }) => {
    if (isCapturePage(window.location.pathname, window.location.search)) return;
    refresh(showcaseId);
  });
}

/* One re-read per showcase at a time: a change that lands during one
 * queues exactly one more, which reads whatever is on disk by then. */
function refresh(showcaseId: string): void {
  if (refreshing.has(showcaseId)) {
    again.add(showcaseId);
    return;
  }
  const run = (async () => {
    await editsSettled();
    const outcome = await refreshShowcase(showcaseId);
    if (outcome === "updated") forgetEditBase(showcaseId);
    if (outcome === "added" || outcome === "removed" || outcome === "unsupported") {
      window.location.reload();
    }
  })()
    .catch((error: unknown) => {
      console.error(`Showcase "${showcaseId}" changed on disk but could not be re-read:`, error);
    })
    .finally(() => {
      refreshing.delete(showcaseId);
      if (again.delete(showcaseId)) refresh(showcaseId);
    });
  refreshing.set(showcaseId, run);
}
