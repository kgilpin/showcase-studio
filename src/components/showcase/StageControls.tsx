/* The row between the stage and the scene rail: controls for how the
 * current view renders and plays. Today, in the TikTok view:
 *
 *   [Safe area] [Frame]  Picture [Fill|Fit]  Focus [Top|Center|Bottom]   (fill)
 *                                            Bands [Blur|Color]          (fit, or fill
 *                                                                         inside an area)
 *                                            [reset]  (the scene sets its own)
 *
 * and in the 4:3 view just [Frame].
 *
 * Safe area is a viewer preference (it shades TikTok's interface, and
 * is never exported). Frame saves a PNG of the video's frame at the
 * scrubber's moment, rendered by the studio the way the export renders
 * it (GET /studio/api/frame), with the safe area shaded when the switch
 * is on — the answer to "what does the TikTok look like at 0:24?". The
 * picture controls edit the current scene's media.tiktok
 * (src/content/tiktok-fit.ts) through commitEdit, so they undo with
 * Cmd/Ctrl+Z like any other edit; they show only where a studio serves
 * the page, and only for a scene whose picture fills the frame
 * (usesTikTokFit). The scrubber sits just above this row
 * (Scrubber.tsx); future rendering and playback controls, such as
 * playback speed, belong here too. */
import { useEffect, useState } from "react";
import { Camera, RotateCcw, ScanLine } from "lucide-react";
import { cn } from "@/lib/utils";
import { commitEdit } from "@/lib/edits";
import { studio } from "@/lib/studio";
import type { Scene } from "@/content/showcases";
import { hasBands, usesTikTokFit, type TikTokFitSpec } from "@/content/tiktok-fit";

export function StageControls({
  showcaseId,
  scene,
  view,
  canEdit,
  safeArea,
  onToggleSafeArea,
  atMs,
}: {
  showcaseId: string;
  scene: Scene;
  view: "screens" | "tiktok" | "embed";
  canEdit: boolean;
  safeArea: boolean;
  onToggleSafeArea: () => void;
  /** The scrubber's moment, in ms from the start of the showcase. */
  atMs: number;
}) {
  if (view === "screens") return null;
  if (view === "embed") {
    return (
      <div
        className="z-20 flex shrink-0 flex-wrap items-center justify-center gap-x-5 gap-y-2 px-6 pt-4 text-xs text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <FrameButton showcaseId={showcaseId} atMs={atMs} view="43" safeArea={false} />
      </div>
    );
  }
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
      <FrameButton showcaseId={showcaseId} atMs={atMs} view="tiktok" safeArea={safeArea} />
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
          {fit.fit === "fill" && (
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
          )}
          {hasBands(fit) && (
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

/** Saves the video's frame at `atMs` as a PNG: the studio renders it
 *  (seconds — the button says "Rendering…" meanwhile) and the browser
 *  downloads it as <id>-t<ms>.png. Only where a studio serves the page;
 *  a failure shows in place, with the studio's reason as the title. */
function FrameButton({
  showcaseId,
  atMs,
  view,
  safeArea,
}: {
  showcaseId: string;
  atMs: number;
  view: "tiktok" | "43";
  safeArea: boolean;
}) {
  const [inStudio, setInStudio] = useState(false);
  useEffect(() => setInStudio(Boolean(studio()?.frame)), []);
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  if (!inStudio) return null;
  const capture = async () => {
    setState({ busy: true });
    const result = await studio()!.frame(showcaseId, { atMs, view, safeArea });
    if (!result.ok) {
      setState({ busy: false, error: result.error });
      return;
    }
    const url = URL.createObjectURL(result.blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = result.name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setState({ busy: false });
  };
  return (
    <button
      type="button"
      disabled={state.busy}
      title={
        state.error
          ? `The frame didn't render: ${state.error}`
          : `Save this moment of the ${view === "43" ? "4:3" : "TikTok"} video as a PNG` +
            (safeArea ? ", with the safe area shaded" : "")
      }
      onClick={() => void capture()}
      className={cn(
        "flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 transition-colors",
        state.error ? "text-amber-400" : "text-support hover:text-foreground",
        state.busy && "cursor-progress opacity-70",
      )}
    >
      <Camera className="size-3.5" />
      {state.busy ? "Rendering…" : state.error ? "Frame failed" : "Frame"}
    </button>
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
