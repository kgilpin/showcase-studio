import { cn } from "@/lib/utils";

export function ProgressRail({
  count,
  index,
  progress,
  durations,
  onSelect,
}: {
  count: number;
  index: number;
  progress: number;
  /** Duration of each slide in seconds, shown under each segment. */
  durations: number[];
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex w-full max-w-md items-start gap-2">
      {Array.from({ length: count }).map((_, i) => {
        const isActive = i === index;
        const isCompleted = i < index;
        const fill = isCompleted ? "100%" : isActive ? `${progress * 100}%` : "0%";
        const duration = durations[i] ?? 0;

        return (
          <button
            key={i}
            type="button"
            aria-label={`Go to scene ${i + 1}`}
            aria-current={isActive ? "step" : undefined}
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
                isActive ? "text-primary" : "text-muted-foreground/60",
              )}
            >
              {duration.toFixed(1)}s
            </span>
          </button>
        );
      })}
    </div>
  );
}
