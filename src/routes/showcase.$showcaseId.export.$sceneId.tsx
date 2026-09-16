import { useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getShowcase } from "@/content/showcases";
import { FIXED_ASPECT, SceneView } from "@/components/showcase/SceneView";
import { stillMomentMs } from "@/lib/still-moment";

/* One scene as a still, phone-shaped frame with no device chrome.
 * The studio's screenshot export (server/exporter.mjs) opens this page at
 * 1320×2868 — the App Store 6.9" screenshot size — and captures it. App
 * Screens presentation: the slide title carries the message and captions
 * stay off (they belong to the video, where they narrate over the media
 * instead).
 *
 * The still shows the scene as it looks when it finishes playing
 * (src/lib/still-moment.ts): graphics fully revealed, motion complete.
 * CSS animations and videos run on the page's real clock, so the page
 * moves each of them to that moment, and exposes the same step as
 * window.__still() for the capture to call once everything has loaded. */
export const Route = createFileRoute("/showcase/$showcaseId/export/$sceneId")({
  head: ({ params }) => ({
    meta: [{ title: `Export — ${params.showcaseId}/${params.sceneId}` }],
  }),
  component: ExportFrame,
});

declare global {
  interface Window {
    /** Moves every animation and video on the page to the still's moment;
     *  resolves once the videos have their frame. */
    __still?: () => Promise<void>;
  }
}

/** Every animation started when the scene mounted, so the moment into
 *  the scene is the moment into each animation. Videos loop, like the
 *  player's. */
async function holdAt(ms: number) {
  for (const animation of document.getAnimations()) {
    animation.pause();
    animation.currentTime = ms;
  }
  const videos = [...document.querySelectorAll("video")];
  for (const video of videos) {
    video.pause();
    const seconds = ms / 1000;
    video.currentTime = video.duration ? seconds % video.duration : seconds;
  }
  const deadline = Date.now() + 2000;
  while (videos.some((v) => v.seeking) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function ExportFrame() {
  const { showcaseId, sceneId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  const scene = showcase?.scenes.find((s) => s.id === sceneId);
  const moment = scene ? stillMomentMs(scene) : 0;

  useEffect(() => {
    if (!scene) return undefined;
    window.__still = () => holdAt(moment);
    // For a person viewing the page; the capture calls it again once loaded.
    const frame = requestAnimationFrame(() => void holdAt(moment));
    return () => {
      cancelAnimationFrame(frame);
      delete window.__still;
    };
  }, [scene, moment]);

  if (!showcase) return null; // the layout route renders the not-found message
  if (!scene) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background text-muted-foreground">
        <p>
          Unknown scene id &quot;{sceneId}&quot; —{" "}
          <Link to="/showcase/$showcaseId/export" params={{ showcaseId }} className="underline">
            back to the export gallery
          </Link>
        </p>
      </main>
    );
  }
  return (
    <main className="export-static flex h-dvh w-full items-center justify-center overflow-hidden bg-background">
      <div className="relative h-full max-w-full" style={{ aspectRatio: FIXED_ASPECT }}>
        <SceneView scene={scene} paused elapsedMs={moment} frameless hideCaption />
      </div>
    </main>
  );
}
