import { cn } from "@/lib/utils";
import type { Scene } from "@/content/showcases";
import { captionCopySummary, formatSeconds } from "@/content/timing.mjs";

/** What the rail reads from each scene: its length, its length limit, and
 *  the copy it carries (shown on hover, so an author can see which slide
 *  has too many words without opening the script). */
export type RailScene = Pick<Scene, "durationMs" | "maxMs" | "overMs" | "captions">;

/** The tooltip for one segment: the copy, and how far over the maximum
 *  the scene runs when it does. */
function sceneRailDetail(scene: RailScene): string {
  const copy = captionCopySummary(scene);
  if (scene.overMs == null || scene.maxMs == null) return copy;
  return `${copy} — ${formatSeconds(scene.overMs)} over the ${formatSeconds(scene.maxMs)} maximum`;
}

export function ProgressRail({
  scenes,
  index,
  progress,
  targetMs,
  onSelect,
}: {
  scenes: RailScene[];
  index: number;
  progress: number;
  /** meta.targetMs — the total is shown against it when set. */
  targetMs?: number | undefined;
  onSelect: (i: number) => void;
}) {
  const totalMs = scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  const overTarget = targetMs != null && totalMs > targetMs;
  return (
    <div className="flex w-full max-w-md items-start gap-2">
      {scenes.map((scene, i) => {
        const isActive = i === index;
        const isCompleted = i < index;
        const fill = isCompleted ? "100%" : isActive ? `${progress * 100}%` : "0%";
        const over = scene.overMs != null;

        return (
          <button
            key={i}
            type="button"
            aria-label={`Go to scene ${i + 1}`}
            aria-current={isActive ? "step" : undefined}
            title={sceneRailDetail(scene)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(i);
            }}
            className="group flex h-10 flex-1 flex-col items-center justify-start gap-1"
          >
            <span
              className={cn(
                "block h-2 w-full overflow-hidden rounded-full transition-colors",
                isActive ? "bg-muted-foreground/25" : "bg-secondary",
                "group-hover:bg-muted-foreground/35",
                /* A scene over its maximum wears an amber ring, so the
                 * long slides show at a glance (issue #21). */
                over && "ring-1 ring-amber-400/80",
              )}
            >
              <span
                className={cn(
                  "block h-full rounded-full bg-[image:var(--gradient-accent)] transition-[width] duration-75 ease-linear",
                  isActive && "shadow-[0_0_10px_rgba(96,165,250,0.45)]",
                )}
                style={{ width: fill }}
              />
            </span>
            <span
              className={cn(
                "text-[0.65rem] tabular-nums leading-none transition-colors",
                over ? "text-amber-400/90" : isActive ? "text-primary" : "text-muted-foreground/60",
              )}
            >
              {(scene.durationMs / 1000).toFixed(1)}s
            </span>
          </button>
        );
      })}
      {targetMs != null && (
        <span
          title={
            overTarget
              ? `Runs ${formatSeconds(totalMs)}, ${formatSeconds(totalMs - targetMs)} over the ${formatSeconds(targetMs)} target`
              : `Runs ${formatSeconds(totalMs)} of the ${formatSeconds(targetMs)} target`
          }
          className={cn(
            "shrink-0 self-start pt-3 text-[0.65rem] tabular-nums leading-none",
            overTarget ? "text-amber-400/90" : "text-muted-foreground/60",
          )}
        >
          {formatSeconds(totalMs)} / {formatSeconds(targetMs)}
        </span>
      )}
    </div>
  );
}
