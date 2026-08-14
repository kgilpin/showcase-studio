import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Columns2, FileText, Home, Layers, Pause, Play, SkipBack, SkipForward } from "lucide-react";
import { cn } from "@/lib/utils";
import { activeCaption, type Showcase } from "@/content/showcases";
import { FIXED_ASPECT, SceneView } from "./SceneView";
import { ProgressRail } from "./ProgressRail";
import { Soundtrack } from "./Soundtrack";
import { useMediaPreload } from "./useMediaPreload";

export function ShowcasePlayer({ showcase }: { showcase: Showcase }) {
  const scenes = showcase.scenes;
  useMediaPreload(scenes);
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  /* Two presentations, matching the two exports: "screens" (App Screens —
   * titles on the slide, captions beside it) and "video" (TikTok — captions
   * over the media, no titles competing with them). */
  const [presentation, setPresentation] = useState<"screens" | "video">("screens");
  const scene = scenes[index] ?? scenes[0]!;

  const go = useCallback((next: number) => {
    setProgress(0);
    setIndex(next);
  }, []);

  const advance = useCallback(() => {
    const next = index + 1;
    if (next < scenes.length) go(next);
    else if (showcase.loop) go(0);
    else setPaused(true);
  }, [index, go, scenes.length, showcase.loop]);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  useEffect(() => {
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      if (!pausedRef.current) {
        elapsed += delta;
        const ratio = Math.min(elapsed / scene.durationMs, 1);
        setProgress(ratio);
        if (ratio >= 1) {
          advanceRef.current();
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [index, scene.durationMs]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === "ArrowRight") advanceRef.current();
      if (e.key === "ArrowLeft") go(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go]);

  const elapsedMs = progress * scene.durationMs;
  const caption = activeCaption(scene, elapsedMs);
  const captionText = caption?.text ?? scene.body;
  const sideCaptions =
    presentation === "screens" && scene.media.kind !== "none" && scene.theme !== "title";

  return (
    <main
      onClick={() => setPaused((p) => !p)}
      className="flex h-dvh w-full flex-col select-none overflow-hidden"
      style={{ background: "var(--gradient-stage)" }}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 pt-4 sm:flex-row sm:gap-4 md:gap-5">
        <div className="relative h-full min-h-0 shrink-0" style={{ aspectRatio: FIXED_ASPECT }}>
          <SceneView
            key={scene.id}
            scene={scene}
            paused={paused}
            mode="fixed-overlay"
            elapsedMs={elapsedMs}
            hideCaption={sideCaptions}
            hideTitle={presentation === "video"}
          />
        </div>
        <div className="hidden shrink-0 items-center justify-start sm:flex sm:w-56 md:w-60 lg:w-64">
          {sideCaptions && captionText && (
            <p
              key={captionText}
              className="caption-fade text-left text-lg leading-snug text-muted-foreground md:text-xl"
            >
              {captionText}
            </p>
          )}
        </div>
      </div>

      <div
        className="z-20 flex shrink-0 flex-col items-center gap-4 px-6 py-7 sm:px-10"
        onClick={(e) => e.stopPropagation()}
      >
        <ProgressRail
          count={scenes.length}
          index={index}
          progress={progress}
          durations={scenes.map((s) => s.durationMs / 1000)}
          onSelect={(i) => go(i)}
        />
        <div className="flex items-center gap-2 text-muted-foreground">
          <Control label="Previous scene" onClick={() => go(Math.max(0, index - 1))}>
            <SkipBack className="size-4" />
          </Control>
          <Control label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)}>
            {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
          </Control>
          <Control label="Next scene" onClick={() => advanceRef.current()}>
            <SkipForward className="size-4" />
          </Control>
          <Soundtrack paused={paused} soundtrack={showcase.soundtrack} />
          <Control
            label={
              presentation === "screens"
                ? "Video presentation: captions over the media, no titles"
                : "App Screens presentation: titles on the slide, captions beside"
            }
            onClick={() => setPresentation((p) => (p === "screens" ? "video" : "screens"))}
          >
            {presentation === "screens" ? (
              <Columns2 className="size-4" />
            ) : (
              <Layers className="size-4" />
            )}
          </Control>
          <Link
            to="/showcase/$showcaseId/script"
            params={{ showcaseId: showcase.id }}
            aria-label="View the script"
            onClick={(e) => e.stopPropagation()}
            className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
          >
            <FileText className="size-4" />
          </Link>
          <Link
            to="/"
            aria-label="All showcases"
            onClick={(e) => e.stopPropagation()}
            className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
          >
            <Home className="size-4" />
          </Link>
        </div>
      </div>
    </main>
  );
}

function Control({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="rounded-full border border-border bg-card/60 p-2.5 text-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
    >
      {children}
    </button>
  );
}
