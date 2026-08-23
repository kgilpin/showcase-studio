import { Link } from "@tanstack/react-router";
import { ArrowLeft, Home } from "lucide-react";

/* Home, pinned to the same top-left corner on every screen, with an
 * optional back link to the previous screen beside it. Folder and export
 * actions live in the system File menu (electron/main.mjs), not here.
 * Clicks don't bubble (the player toggles pause on background clicks). */
export function HomeBackNav({
  showcaseId,
  backLabel,
}: {
  showcaseId?: string;
  backLabel?: string;
}) {
  return (
    <div
      className="fixed left-4 top-4 z-40 flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      <Link
        to="/"
        aria-label="All showcases"
        title="All showcases"
        className="inline-flex rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Home className="size-4" />
      </Link>
      {showcaseId && backLabel && (
        <Link
          to="/showcase/$showcaseId"
          params={{ showcaseId }}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-2 text-sm text-foreground/70 backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>
      )}
    </div>
  );
}
