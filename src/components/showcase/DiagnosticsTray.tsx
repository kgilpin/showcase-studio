import { useState } from "react";
import { ChevronDown, ChevronUp, CircleX, TriangleAlert } from "lucide-react";
import { showcaseErrors, showcaseWarnings } from "@/content/showcases";

/* The diagnostics tray: a status bar pinned to the bottom of the page
 * with the library's error and warning counts (VS Code style), expanding
 * into the full list. Renders nothing when there is nothing to say, so
 * plain viewers never see IDE furniture. Errors are showcases that failed
 * to load entirely; warnings come from the theme linter. */
export function DiagnosticsTray() {
  const [open, setOpen] = useState(false);
  const total = showcaseErrors.length + showcaseWarnings.length;
  if (total === 0) return null;

  return (
    <div
      className="z-30 shrink-0 border-t border-border bg-card/90 text-xs backdrop-blur-md"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Toggle diagnostics"
        className="flex w-full items-center gap-4 px-4 py-1.5 text-support transition-colors hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <CircleX className={showcaseErrors.length ? "size-3.5 text-red-400" : "size-3.5"} />
          {showcaseErrors.length}
        </span>
        <span className="flex items-center gap-1.5">
          <TriangleAlert
            className={showcaseWarnings.length ? "size-3.5 text-amber-400" : "size-3.5"}
          />
          {showcaseWarnings.length}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {open ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </span>
      </button>
      {open && (
        <ul className="max-h-44 space-y-1.5 overflow-y-auto border-t border-border px-4 py-2.5">
          {showcaseErrors.map((error) => (
            <li key={error.id} className="leading-relaxed text-red-400">
              <span className="font-mono">{error.id}</span> — {error.message}
            </li>
          ))}
          {showcaseWarnings.map((warning, i) => (
            <li key={i} className="leading-relaxed text-amber-400/90">
              <span className="font-mono">
                {warning.showcaseId}/{warning.sceneId}
              </span>{" "}
              — {warning.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
