import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { getShowcase } from "@/content/showcases";
import { FIXED_ASPECT, SceneView } from "@/components/showcase/SceneView";

export const Route = createFileRoute("/showcase/$showcaseId/export/")({
  head: ({ params }) => {
    const showcase = getShowcase(params.showcaseId);
    return {
      meta: [{ title: showcase ? `Export — ${showcase.title}` : "Export gallery" }],
    };
  },
  component: ExportGallery,
});

/* Browsable preview of every frame the export script will capture.
 * Each tile renders the real scene at half size; click one to open the
 * full-size frame that Playwright screenshots. */
function ExportGallery() {
  const { showcaseId } = Route.useParams();
  const showcase = getShowcase(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message

  const skipped = showcase.scenes.length - showcase.exportScenes.length;
  return (
    <main
      className="min-h-dvh w-full px-6 py-14 sm:px-10"
      style={{ background: "var(--gradient-stage)" }}
    >
      <div className="mx-auto max-w-6xl">
        <Link
          to="/showcase/$showcaseId"
          params={{ showcaseId }}
          className="inline-flex items-center gap-2 text-sm text-support transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to the showcase
        </Link>
        <header className="mt-8 border-b border-border pb-8">
          <p className="text-xs uppercase tracking-[0.42em] text-primary">Export</p>
          <h1 className="mt-4 font-display text-5xl leading-tight tracking-tight text-foreground">
            App Store screenshots
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            These are the frames <code>npm run export:screens -- {showcase.id}</code> captures at
            1320×2868 (the 6.9&quot; App Store size). Scenes marked <code>export: false</code> in{" "}
            <code>showcase.yaml</code> are left out{skipped > 0 ? ` (${skipped} skipped)` : ""}.
          </p>
        </header>

        <div className="mt-10 flex flex-wrap gap-8">
          {showcase.exportScenes.map((scene, i) => (
            <Link
              key={scene.id}
              to="/showcase/$showcaseId/export/$sceneId"
              params={{ showcaseId, sceneId: scene.id }}
              className="group block w-[220px]"
            >
              <div
                className="export-static relative w-full overflow-hidden rounded-xl border border-border transition-colors group-hover:border-primary"
                style={{ aspectRatio: FIXED_ASPECT }}
              >
                {/* Render at capture width (440px) and scale down to the tile. */}
                <div
                  className="absolute left-0 top-0 origin-top-left"
                  style={{ width: 440, aspectRatio: FIXED_ASPECT, transform: "scale(0.5)" }}
                >
                  <div className="relative h-full w-full">
                    <SceneView
                      scene={scene}
                      paused
                      mode="fixed-overlay"
                      elapsedMs={scene.durationMs / 2}
                      frameless
                      captionSize={showcase.captions.size}
                    />
                  </div>
                </div>
              </div>
              <p className="mt-3 text-sm text-foreground">
                {String(i + 1).padStart(2, "0")} · {scene.id}
              </p>
              <p className="mt-1 line-clamp-2 text-xs text-support">{scene.title}</p>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
