import { useEffect } from "react";
import { X } from "lucide-react";
import { showcaseAssets, type Scene, type Showcase } from "@/content/showcases";
import { commitEdit } from "@/lib/edits";
import { cn } from "@/lib/utils";

/** Thumbnail grid over the showcase's assets folder: click one to point
 *  the scene's media at it. Picking a video for an image scene (or the
 *  other way round) also updates media.kind, so the swap always plays. */
export function MediaPicker({
  showcase,
  scene,
  onClose,
}: {
  showcase: Showcase;
  scene: Scene;
  onClose: () => void;
}) {
  const choices = showcaseAssets(showcase).assets.filter(
    (asset) => asset.kind === "image" || asset.kind === "video",
  );
  const current =
    scene.media.kind === "image" || scene.media.kind === "video" ? scene.media.file : undefined;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <p className="text-sm text-foreground">
            Media for <span className="font-mono text-xs text-support">{scene.id}</span>
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the media picker"
            title="Close the media picker"
            className="rounded-full border border-border p-1.5 text-support transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>
        {choices.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-support">
            No images or videos in this showcase's assets folder yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-4 overflow-y-auto p-6 sm:grid-cols-4">
            {choices.map((asset) => (
              <button
                key={asset.file}
                type="button"
                onClick={() => {
                  if (asset.file !== current) {
                    const mediaKind = asset.kind === "video" ? "video" : "image";
                    /* Image/video scenes patch just the asset (keeping
                     * motion, frame, alt); a graphic or empty scene
                     * swaps its whole media mapping — the inverse swaps
                     * it back, so undo restores the graphic. */
                    const edit =
                      scene.media.kind === "image" || scene.media.kind === "video"
                        ? ({ field: "media.asset", value: asset.key, mediaKind } as const)
                        : ({
                            field: "media.set",
                            media: {
                              kind: mediaKind,
                              asset: asset.key,
                              alt:
                                "alt" in scene.media && typeof scene.media.alt === "string"
                                  ? scene.media.alt
                                  : asset.name,
                            },
                          } as const);
                    void commitEdit(showcase.id, scene.id, edit);
                  }
                  onClose();
                }}
                className={cn(
                  "group flex flex-col gap-1.5 rounded-xl border p-2 text-left transition-colors",
                  asset.file === current
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-foreground/40 hover:bg-secondary/40",
                )}
              >
                <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-background">
                  {asset.kind === "video" ? (
                    <video
                      src={asset.url}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
                  )}
                </div>
                <span className="break-all text-[0.65rem] leading-snug text-support group-hover:text-foreground">
                  {asset.name}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
