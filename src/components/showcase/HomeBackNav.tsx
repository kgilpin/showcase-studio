import { Link } from "@tanstack/react-router";
import { ArrowLeft, Home } from "lucide-react";
import { useWindowLock } from "@/lib/studio";

/* Home, pinned top-left on the screens outside a showcase's tabs (the
 * home page, New showcase, Export), with an optional back link to the
 * previous screen beside it. The player, Script, and Assets screens use
 * the tab bar (ShowcaseNav) instead. Folder and export
 * actions live in the system File menu (electron/main.mjs), not here.
 * A locked window (--open / --new) has no Home: it can't switch
 * showcases. Clicks don't bubble (the player toggles pause on background
 * clicks). */
export function HomeBackNav({
  showcaseId,
  backLabel,
}: {
  showcaseId?: string;
  backLabel?: string;
}) {
  const locked = useWindowLock() != null;
  return (
    <div
      className="fixed left-4 top-4 z-40 flex items-center gap-2"
      onClick={(e) => e.stopPropagation()}
    >
      {!locked && (
        <Link
          to="/"
          aria-label="All showcases"
          title="All showcases"
          className="inline-flex rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 backdrop-blur-sm transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Home className="size-4" />
        </Link>
      )}
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
