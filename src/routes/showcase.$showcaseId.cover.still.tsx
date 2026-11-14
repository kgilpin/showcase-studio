import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { coverFor, getShowcase } from "@/content/showcases";
import { COVER_DESTINATIONS, type CoverDestination } from "@/content/cover-rules.mjs";
import { CoverView } from "@/components/cover/CoverView";

/* A showcase's cover alone, filling the page with nothing around it —
 * what the studio captures at 1080×1920 to save the cover as a PNG
 * (GET /studio/api/cover, the screenshot_cover tool). `?destination=`
 * picks that destination's cover; without it, the default. A capture
 * page (src/lib/window-lock.mjs): no lock, no live reload.
 *
 * Graphics are drawn finished: window.__still (called by the capture,
 * like the screenshot export's) moves every animation to its end. */
export const Route = createFileRoute("/showcase/$showcaseId/cover/still")({
  validateSearch: (search: Record<string, unknown>): { destination?: CoverDestination } =>
    typeof search["destination"] === "string" && search["destination"] in COVER_DESTINATIONS
      ? { destination: search["destination"] as CoverDestination }
      : {},
  head: ({ params }) => ({ meta: [{ title: `Cover — ${params.showcaseId}` }] }),
  component: CoverStill,
});

declare global {
  interface Window {
    __still?: () => Promise<void>;
  }
}

/** Moves every animation on the page to its end (an endless one to 3 s
 *  in), so a graphic shows its resting state. */
function finishAnimations(): Promise<void> {
  for (const animation of document.getAnimations()) {
    const end = animation.effect?.getComputedTiming().endTime;
    animation.pause();
    animation.currentTime = typeof end === "number" && Number.isFinite(end) ? end : 3000;
  }
  return Promise.resolve();
}

function CoverStill() {
  const { showcaseId } = Route.useParams();
  const { destination } = Route.useSearch();
  const showcase = getShowcase(showcaseId);
  const cover = showcase ? coverFor(showcase, destination) : undefined;

  useEffect(() => {
    window.__still = finishAnimations;
    const frame = requestAnimationFrame(() => void finishAnimations());
    return () => {
      cancelAnimationFrame(frame);
      delete window.__still;
    };
  }, []);

  if (!showcase) return null; // the layout route renders the not-found message
  if (!cover) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        <p>&quot;{showcaseId}&quot; has no cover yet (no cover.yaml).</p>
      </main>
    );
  }
  return (
    <main className="export-static flex h-dvh w-full items-center justify-center overflow-hidden bg-background">
      <CoverView cover={cover} className="h-full max-w-full" />
    </main>
  );
}
