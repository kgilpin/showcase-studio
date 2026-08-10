import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, X } from "lucide-react";
import { captionTimeline, type Scene } from "@/content/showcases";
import { cn } from "@/lib/utils";

type Props = { scenes: Scene[]; onExit: () => void };

type Line = {
  key: string;
  kind: "title" | "caption" | "support";
  text: string;
  eyebrow?: string | undefined;
  sceneIndex: number;
  startMs: number;
  endMs: number;
};

/** Flattens every slide into one continuous, time-coded script. */
function buildLines(scenes: Scene[]): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  scenes.forEach((scene, sceneIndex) => {
    const timeline = captionTimeline(scene);
    lines.push({
      key: `${scene.id}-title`,
      kind: "title",
      text: scene.title,
      eyebrow: scene.eyebrow,
      sceneIndex,
      startMs: offset,
      endMs: offset + (timeline[0]?.startMs ?? scene.durationMs),
    });
    timeline.forEach((caption, i) => {
      lines.push({
        key: `${scene.id}-c${i}`,
        kind: "caption",
        text: caption.text,
        sceneIndex,
        startMs: offset + caption.startMs,
        endMs: offset + caption.endMs,
      });
    });
    if (scene.support) {
      const lastEnd = timeline.at(-1)?.endMs ?? 0;
      lines.push({
        key: `${scene.id}-support`,
        kind: "support",
        text: scene.support,
        sceneIndex,
        startMs: offset + Math.min(lastEnd, scene.durationMs),
        endMs: offset + scene.durationMs,
      });
    }
    offset += scene.durationMs;
  });
  return lines;
}

/** Pie-style countdown for the active line: the filled wedge is the time
 *  left in this line's window, beside the seconds remaining. */
function LinePie({ remainingMs, allottedMs }: { remainingMs: number; allottedMs: number }) {
  const fraction = Math.max(0, Math.min(1, remainingMs / allottedMs));
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="text-xs tabular-nums text-primary">
        {(Math.max(0, remainingMs) / 1000).toFixed(1)}s
      </span>
      <span
        aria-hidden
        className="inline-block size-5 shrink-0 rounded-full border border-primary/50"
        style={{ background: `conic-gradient(var(--primary) ${fraction * 360}deg, transparent 0)` }}
      />
    </span>
  );
}

/** Lyrics-style teleprompter: the whole script scrolls continuously and the
 *  current line stays pinned near the top so a narrator reads from one spot. */
export function ScriptPlayer({ scenes, onExit }: Props) {
  const lines = useMemo(() => buildLines(scenes), [scenes]);
  const total = useMemo(() => scenes.reduce((s, x) => s + x.durationMs, 0), [scenes]);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const last = useRef<number | null>(null);

  let activeIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    if (elapsed >= lines[i]!.startMs) activeIndex = i;
  }
  const active = lines[activeIndex]!;
  const scene = scenes[active.sceneIndex]!;

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = (t: number) => {
      if (last.current == null) last.current = t;
      const dt = t - last.current;
      last.current = t;
      setElapsed((e) => (e + dt >= total ? 0 : e + dt));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      last.current = null;
    };
  }, [playing, total]);

  /* Keep the active line pinned near the top of the scroll area. */
  useEffect(() => {
    const container = scrollRef.current;
    const el = lineRefs.current[active.key];
    if (!container || !el) return;
    container.scrollTo({
      top: el.offsetTop - container.clientHeight * 0.18,
      behavior: "smooth",
    });
  }, [active.key]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  const media = scene.media;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col"
      style={{ background: "var(--gradient-stage)" }}
    >
      <div className="flex items-center justify-between px-6 py-4">
        <p className="text-xs uppercase tracking-[0.32em] text-support">
          Slide {active.sceneIndex + 1} / {scenes.length} · {Math.floor(elapsed / 1000)}s /{" "}
          {Math.round(total / 1000)}s
        </p>
        <button
          type="button"
          onClick={onExit}
          aria-label="Exit script player"
          className="rounded-full border border-border p-2 text-support transition-colors hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-8 px-6 pb-4 sm:px-12">
        <div className="hidden w-44 shrink-0 self-center sm:block lg:w-56">
          {media.kind === "graphic" ? (
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-card">
              <media.component />
            </div>
          ) : media.kind !== "none" ? (
            <img
              key={media.src}
              src={media.src}
              alt={media.alt}
              className="w-full rounded-2xl border border-border object-contain"
            />
          ) : (
            <div className="flex aspect-[9/19.5] w-full items-center justify-center rounded-2xl border border-dashed border-border/60 text-[0.65rem] uppercase tracking-[0.28em] text-support/60">
              No media
            </div>
          )}
        </div>

        <div
          ref={scrollRef}
          className="relative min-w-0 flex-1 overflow-y-auto scroll-smooth [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_70%,transparent)]"
        >
          <ul className="space-y-6 pb-[60vh] pt-6">
            {lines.map((line) => {
              const isActive = line.key === active.key;
              const isPast = line.endMs <= elapsed;
              const allottedMs = line.endMs - line.startMs;
              return (
                <li
                  key={line.key}
                  ref={(el) => {
                    lineRefs.current[line.key] = el;
                  }}
                  className={cn(
                    "flex gap-5 transition-all duration-500",
                    isActive ? "opacity-100" : isPast ? "opacity-25" : "opacity-45",
                  )}
                >
                  {/* Pacing gutter: allotted seconds; the active line counts
                   *  down with a pie. Zero-width windows (a title that shares
                   *  its time with the first caption) get no indicator. */}
                  <div className="w-20 shrink-0 pt-2 text-right">
                    {allottedMs >= 400 &&
                      (isActive ? (
                        <LinePie remainingMs={line.endMs - elapsed} allottedMs={allottedMs} />
                      ) : (
                        <span className="text-xs tabular-nums text-support/80">
                          {(allottedMs / 1000).toFixed(1)}s
                        </span>
                      ))}
                  </div>
                  <div className="min-w-0 flex-1">
                    {line.kind === "title" ? (
                      <>
                        {line.eyebrow && (
                          <p className="text-xs uppercase tracking-[0.42em] text-primary">
                            {line.eyebrow}
                          </p>
                        )}
                        <h2
                          className={cn(
                            "mt-2 font-display leading-tight tracking-tight text-foreground",
                            isActive ? "text-4xl sm:text-5xl" : "text-3xl sm:text-4xl",
                          )}
                        >
                          {line.text}
                        </h2>
                      </>
                    ) : line.kind === "support" ? (
                      <p className="text-lg leading-relaxed text-muted-foreground sm:text-xl">
                        {line.text}
                      </p>
                    ) : (
                      <p
                        className={cn(
                          "leading-snug",
                          isActive
                            ? "text-3xl text-foreground sm:text-4xl"
                            : "text-2xl text-muted-foreground sm:text-3xl",
                        )}
                      >
                        {line.text}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="flex items-center justify-center gap-4 border-t border-border px-6 py-4">
        <button
          type="button"
          onClick={() => setElapsed(0)}
          aria-label="Restart script"
          className="rounded-full border border-border p-2 text-support transition-colors hover:text-foreground"
        >
          <RotateCcw className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          aria-label={playing ? "Pause" : "Play"}
          className="rounded-full border border-border p-3 text-foreground transition-colors hover:bg-card"
        >
          {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
        </button>
      </div>

      <div className="h-1 w-full bg-muted-foreground/20">
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }}
        />
      </div>
    </div>
  );
}
