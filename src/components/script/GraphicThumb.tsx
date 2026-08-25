import { useEffect, useState, type ComponentType } from "react";
import { X } from "lucide-react";

/** Clickable TSX-graphic thumbnail that opens a full-size preview.
 *  Both boxes are `@container` scopes — graphics draw themselves in
 *  container-width units, so without one they'd size to the viewport. */
export function GraphicThumb({
  component: Graphic,
  caption,
}: {
  component: ComponentType;
  caption?: string | undefined;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Preview full size"
        className="block w-full transition-opacity hover:opacity-80"
      >
        <div className="@container relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-border bg-card">
          <Graphic />
        </div>
      </button>
      {caption && (
        <p className="mt-2 break-all text-[0.65rem] leading-snug text-support">{caption}</p>
      )}
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={caption ?? "Graphic preview"}
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 p-6 backdrop-blur-sm"
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close preview"
            className="absolute right-5 top-5 rounded-full border border-border p-2 text-support transition-colors hover:text-foreground"
          >
            <X className="size-5" />
          </button>
          <div
            onClick={(e) => e.stopPropagation()}
            className="@container relative aspect-[16/10] w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-card"
          >
            <Graphic />
          </div>
        </div>
      )}
    </div>
  );
}
