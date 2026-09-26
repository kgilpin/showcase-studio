/* The row between the stage and the scene rail: controls for how the
 * current view renders and plays. Today, in the TikTok view:
 *
 *   [Safe area]  Picture [Fill|Fit]  Focus [Top|Center|Bottom]   (fill)
 *                                    Bands [Blur|Color]          (fit)
 *                                    [reset]  (the scene sets its own)
 *
 * Safe area is a viewer preference (it shades TikTok's interface, and
 * is never exported). The picture controls edit the current scene's
 * media.tiktok (src/content/tiktok-fit.ts) through commitEdit, so they
 * undo with Cmd/Ctrl+Z like any other edit; they show only where a
 * studio serves the page, and only for a scene whose picture fills the
 * frame (usesTikTokFit). Future rendering and playback controls —
 * playback speed, a scrubber — belong in this row too. */
import { RotateCcw, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { commitEdit } from "@/lib/edits";
import type { Scene } from "@/content/showcases";
import { usesTikTokFit, type TikTokFitSpec } from "@/content/tiktok-fit";

export function StageControls({
  showcaseId,
  scene,
  view,
  canEdit,
  safeArea,
  onToggleSafeArea,
}: {
  showcaseId: string;
  scene: Scene;
  view: "screens" | "tiktok" | "embed";
  canEdit: boolean;
  safeArea: boolean;
  onToggleSafeArea: () => void;
}) {
  if (view !== "tiktok") return null;
  const media = scene.media;
  const fit =
    canEdit && usesTikTokFit(scene) && (media.kind === "image" || media.kind === "video")
      ? media.tiktok
      : undefined;
  const own = media.kind === "image" || media.kind === "video" ? media.tiktokOwn : undefined;
  /* Each click writes the scene's own setting: what it had, plus the
   * one field changed. */
  const set = (change: TikTokFitSpec) =>
    void commitEdit(showcaseId, scene.id, {
      field: "media.tiktok",
      value: { ...own, ...change },
    });

  return (
    <div
      className="z-20 flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-2 px-6 pt-4 text-xs text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        aria-pressed={safeArea}
        title={
          safeArea
            ? "Hide TikTok's interface areas"
            : "Show where TikTok's tabs, buttons and description will cover the video"
        }
        onClick={onToggleSafeArea}
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 transition-colors",
          safeArea
            ? "bg-secondary text-foreground"
            : "bg-card/60 text-support hover:text-foreground",
        )}
      >
        <ScanLine className="size-3.5" />
        Safe area
      </button>
      {fit && (
        <>
          <Choice
            label="Picture"
            value={fit.fit}
            options={[
              ["fill", "Fill", "Fill the frame and crop what sticks out"],
              ["fit", "Fit", "Show the whole picture, with bands where it doesn't reach"],
            ]}
            onPick={(value) => set({ fit: value })}
          />
          {fit.fit === "fill" ? (
            <Choice
              label="Focus"
              value={fit.focus}
              options={[
                ["top", "Top", "Keep the top of the picture"],
                ["center", "Center", "Keep the middle of the picture"],
                ["bottom", "Bottom", "Keep the bottom of the picture"],
                /* A percentage set in showcase.yaml shows as its own choice. */
                ...(fit.focus.endsWith("%")
                  ? ([[fit.focus, fit.focus, "Set in showcase.yaml"]] as const)
                  : []),
              ]}
              onPick={(value) => set({ focus: value })}
            />
          ) : (
            <Choice
              label="Bands"
              value={fit.bands}
              options={[
                ["blur", "Blur", "Fill the bands with a blurred copy of the picture"],
                ["color", "Color", "Leave the bands the stage background"],
              ]}
              onPick={(value) => set({ bands: value })}
            />
          )}
          {own && (
            <button
              type="button"
              aria-label="Reset this scene's TikTok fit"
              title="Reset: follow the showcase's TikTok fit (meta.tiktok) again"
              onClick={() =>
                void commitEdit(showcaseId, scene.id, { field: "media.tiktok", value: null })
              }
              className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
            >
              <RotateCcw className="size-3.5" />
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** A labeled segmented control. */
function Choice<T extends string>({
  label,
  value,
  options,
  onPick,
}: {
  label: string;
  value: string;
  options: readonly (readonly [T, string, string])[];
  onPick: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-support">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="flex rounded-full border border-border bg-card/60 p-1"
      >
        {options.map(([key, text, title]) => (
          <button
            key={key}
            type="button"
            title={title}
            aria-pressed={value === key}
            onClick={() => value !== key && onPick(key)}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              value === key ? "bg-secondary text-foreground" : "text-support hover:text-foreground",
            )}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
