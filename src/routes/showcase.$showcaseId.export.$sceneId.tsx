import { createFileRoute, Link } from "@tanstack/react-router";
import { getShowcase } from "@/content/showcases";
import { FIXED_ASPECT, SceneView } from "@/components/showcase/SceneView";

/* One scene as a still, phone-shaped frame with no device chrome.
 * `scripts/export-screens.mjs` opens this page at a 440x956 viewport with
 * deviceScaleFactor 3 and screenshots it, producing a 1320x2868 PNG — the
 * App Store 6.9" screenshot size. App Screens presentation: the slide
 * title carries the message and captions stay off (they belong to the
 * video, where they narrate over the media instead). */
export const Route = createFileRoute("/showcase/$showcaseId/export/$sceneId")({
  head: ({ params }) => ({
    meta: [{ title: `Export — ${params.showcaseId}/${params.sceneId}` }],
  }),
  component: ExportFrame,
});

function ExportFrame() {
  const { showcaseId, sceneId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message
  const scene = showcase.scenes.find((s) => s.id === sceneId);
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
        <SceneView
          scene={scene}
          paused
          mode="fixed-overlay"
          elapsedMs={scene.durationMs / 2}
          frameless
          hideCaption
        />
      </div>
    </main>
  );
}
