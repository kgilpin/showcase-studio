/* The Edit scene panel: what changes the video, for the scene you're
 * paused on. The player's "Edit scene" button opens it between the
 * scrubber and the scene rail; pressing play closes it (pause to edit).
 *
 *   Scene 3   Picture [Fill|Fit]  Focus [Top|Center|Bottom]  [reset]   (TikTok view, a
 *             Bands [Blur|Color]                                        picture that fills
 *                                                                       the frame)
 *             [Change picture…]                                        (image or video)
 *   ─────────
 *   Whole video   [Captions and colors…]  [4:3 captions on · auto ↺]  (4:3 view only)
 *
 * The picture controls edit the scene's media.tiktok
 * (src/content/tiktok-fit.ts) through commitEdit, so they undo with
 * Cmd/Ctrl+Z like any other edit, and show only for a scene whose
 * picture fills the TikTok frame (usesTikTokFit). The 4:3 captions
 * switch writes meta.embedCaptions: "auto" follows the voiceover, and
 * the reset removes the key again. How you're watching (view, safe
 * area) is the View menu (ViewMenu); files are the Export menu. */
import { Captions, CaptionsOff, ImagePlus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { commitEdit } from "@/lib/edits";
import { StylePanel } from "@/components/studio/StylePanel";
import type { Scene, Showcase } from "@/content/showcases";
import { embedCaptionsSetting } from "@/content/embed-captions";
import { hasBands, usesTikTokFit, type TikTokFitSpec } from "@/content/tiktok-fit";
import type { PlayerView } from "@/lib/export-kinds.mjs";

const pill =
  "flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-3 py-1.5 text-support transition-colors hover:text-foreground";

export function EditScenePanel({
  showcase,
  scene,
  sceneNumber,
  view,
  onPickMedia,
}: {
  showcase: Showcase;
  scene: Scene;
  /** 1-based, for the panel's label. */
  sceneNumber: number;
  view: PlayerView;
  onPickMedia: () => void;
}) {
  const media = scene.media;
  const picture = media.kind === "image" || media.kind === "video";
  const fit = view === "tiktok" && picture && usesTikTokFit(scene) ? media.tiktok : undefined;
  const own = picture ? media.tiktokOwn : undefined;
  /* Each click writes the scene's own setting: what it had, plus the
   * one field changed. */
  const set = (change: TikTokFitSpec) =>
    void commitEdit(showcase.id, scene.id, {
      field: "media.tiktok",
      value: { ...own, ...change },
    });
  const embedCaptions = embedCaptionsSetting(showcase);

  return (
    <div
      role="group"
      aria-label={`Edit scene ${sceneNumber}`}
      className="z-20 mx-auto mt-4 flex w-fit max-w-[calc(100%-3rem)] shrink-0 flex-col gap-3 rounded-2xl border border-dashed border-primary/50 bg-card/40 px-4 py-3 text-xs text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="font-medium text-foreground" title={`${scene.id} in showcase.yaml`}>
          Scene {sceneNumber}
        </span>
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
                  void commitEdit(showcase.id, scene.id, { field: "media.tiktok", value: null })
                }
                className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </>
        )}
        {picture && (
          <button type="button" onClick={onPickMedia} className={pill}>
            <ImagePlus className="size-3.5" />
            Change picture…
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
        <span className="text-support">Whole video</span>
        <StylePanel showcase={showcase} />
        {view === "embed" && (
          <div className="flex items-center rounded-full border border-border bg-card/60">
            <button
              type="button"
              aria-pressed={embedCaptions.shown}
              title={
                embedCaptions.auto
                  ? embedCaptions.shown
                    ? "Captions show because this showcase has no voiceover. Click to hide them."
                    : "Captions are hidden because this showcase has a voiceover. Click to show them."
                  : `Captions are ${embedCaptions.shown ? "on" : "off"} for 4:3 (saved in showcase.yaml). Click to turn them ${embedCaptions.shown ? "off" : "on"}.`
              }
              onClick={() =>
                void commitEdit(showcase.id, "", {
                  field: "meta.set",
                  name: "embedCaptions",
                  value: !embedCaptions.shown,
                })
              }
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-foreground transition-colors hover:bg-secondary"
            >
              {embedCaptions.shown ? (
                <Captions className="size-3.5" />
              ) : (
                <CaptionsOff className="size-3.5" />
              )}
              4:3 captions {embedCaptions.shown ? "on" : "off"}
              {embedCaptions.auto && <span className="text-support">· auto</span>}
            </button>
            {!embedCaptions.auto && (
              <button
                type="button"
                aria-label="Back to automatic captions"
                title="Back to automatic: hidden with a voiceover, shown without one"
                onClick={() =>
                  void commitEdit(showcase.id, "", {
                    field: "meta.set",
                    name: "embedCaptions",
                    value: null,
                  })
                }
                className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
              >
                <RotateCcw className="size-3" />
              </button>
            )}
          </div>
        )}
      </div>
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
