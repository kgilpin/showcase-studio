import { Link } from "@tanstack/react-router";
import { ArrowLeft, Home } from "lucide-react";

/* The standard top-left navigation: Home | back to the previous screen.
 * Used by the sub-pages of a showcase (script, export gallery); the
 * player renders its own floating Home over the stage. */
export function HomeBackNav({ showcaseId, backLabel }: { showcaseId: string; backLabel: string }) {
  return (
    <div className="flex items-center gap-4">
      <Link
        to="/"
        aria-label="All showcases"
        className="inline-flex items-center text-support transition-colors hover:text-foreground"
      >
        <Home className="size-4" />
      </Link>
      <span aria-hidden className="h-4 w-px bg-border" />
      <Link
        to="/showcase/$showcaseId"
        params={{ showcaseId }}
        className="inline-flex items-center gap-2 text-sm text-support transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> {backLabel}
      </Link>
    </div>
  );
}
