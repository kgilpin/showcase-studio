import { useEffect, useRef, useState } from "react";
import { Palette, RotateCcw } from "lucide-react";
import { commitEdit } from "@/lib/edits";
import type { Showcase } from "@/content/showcases";
import { cn } from "@/lib/utils";

/* The style panel (desktop shell only): caption painting and the caption
 * and stage colors, opened from the player's Edit scene panel as
 * "Captions and colors…" (it applies to the whole video, not the
 * scene). Written through the same whitelisted edit path as every
 * other in-app edit (meta.captionStyle in showcase.yaml; the
 * caption-* colors and the stage background in theme.yaml). Cmd/Ctrl+Z
 * undoes these like any other edit. */

const CAPTION_STYLES = [
  /* "Line" clears the key — chip is the default painting. */
  ["", "Line"],
  ["karaoke", "Karaoke"],
  ["reveal", "Reveal"],
] as const;

const COLOR_ROWS = [
  { label: "Caption chip", group: "colors", name: "caption-chip", fallback: "#080b14" },
  { label: "Caption text", group: "colors", name: "caption-text", fallback: "#ffffff" },
  { label: "Spoken word", group: "colors", name: "caption-word", fallback: "#ffffff" },
  { label: "Slide background", group: "atmosphere", name: "gradient-stage", fallback: "#0a0e17" },
] as const;

export function StylePanel({ showcase, className }: { showcase: Showcase; className?: string }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const activeStyle = CAPTION_STYLES.some(([key]) => key === showcase.captionStyle)
    ? (showcase.captionStyle ?? "")
    : "";

  return (
    <div ref={panelRef} className="relative">
      <button
        type="button"
        aria-label="Captions and colors"
        title="Captions and colors"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-colors",
          open
            ? "border-transparent bg-secondary text-foreground"
            : "border-border bg-card/60 text-support hover:text-foreground",
          className,
        )}
      >
        <Palette className="size-3.5" />
        Captions and colors…
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-3 w-64 rounded-2xl border border-border bg-card p-4 text-left shadow-2xl">
          <p className="text-xs uppercase tracking-[0.2em] text-support">Captions</p>
          <div className="mt-2 flex rounded-full border border-border bg-background/40 p-1 text-xs">
            {CAPTION_STYLES.map(([key, label]) => (
              <button
                key={key}
                type="button"
                aria-pressed={activeStyle === key}
                onClick={() =>
                  void commitEdit(showcase.id, "", { field: "meta.captionStyle", value: key })
                }
                className={cn(
                  "flex-1 rounded-full px-2 py-1.5 transition-colors",
                  activeStyle === key
                    ? "bg-secondary text-foreground"
                    : "text-support hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-xs uppercase tracking-[0.2em] text-support">Colors</p>
          <ul className="mt-1">
            {COLOR_ROWS.map((row) => {
              const current = showcase.theme.vars[row.name];
              const hex = current && /^#[0-9a-f]{6}$/i.test(current) ? current : row.fallback;
              return (
                <li key={row.name} className="flex items-center gap-2 py-1.5">
                  <input
                    type="color"
                    value={hex}
                    aria-label={row.label}
                    onChange={(event) =>
                      void commitEdit(showcase.id, "", {
                        field: "theme",
                        group: row.group,
                        name: row.name,
                        value: event.target.value,
                      })
                    }
                    className="size-6 shrink-0 cursor-pointer rounded border border-border bg-transparent"
                  />
                  <span className="flex-1 text-xs text-muted-foreground">{row.label}</span>
                  {current != null && (
                    <button
                      type="button"
                      aria-label={`Reset ${row.label.toLowerCase()}`}
                      title="Back to the default"
                      onClick={() =>
                        void commitEdit(showcase.id, "", {
                          field: "theme",
                          group: row.group,
                          name: row.name,
                          value: "",
                        })
                      }
                      className="rounded-full p-1 text-support transition-colors hover:text-foreground"
                    >
                      <RotateCcw className="size-3" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
