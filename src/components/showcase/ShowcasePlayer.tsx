import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Columns2,
  FileText,
  Layers,
  Pause,
  Play,
  RectangleHorizontal,
  SkipBack,
  SkipForward,
  Smartphone,
} from "lucide-react";
import { HomeBackNav } from "./HomeBackNav";
import { DiagnosticsTray } from "./DiagnosticsTray";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/lib/typing-target";
import { activeCaption, type Showcase } from "@/content/showcases";
import { FIXED_ASPECT, SceneView } from "./SceneView";
import { EMBED_ASPECT, EmbedSceneView } from "./EmbedSceneView";
import { ProgressRail } from "./ProgressRail";
import { Soundtrack } from "./Soundtrack";
import { useMediaPreload } from "./useMediaPreload";

export function ShowcasePlayer({ showcase }: { showcase: Showcase }) {
  const scenes = showcase.scenes;
  useMediaPreload(scenes);
  /* Live reload (the studio watcher reloads the page on every file save)
   * must not lose the viewer's place. The position is saved in
   * beforeunload — which only fires on real page reloads, never on
   * in-app navigation — and consumed once here, so opening a showcase
   * fresh still starts at the top. */
  const [index, setIndex] = useState(() => {
    if (typeof window === "undefined") return 0;
    const saved = sessionStorage.getItem("player-resume");
    if (!saved) return 0;
    sessionStorage.removeItem("player-resume");
    try {
      const pos = JSON.parse(saved) as { id: string; index: number };
      if (pos.id === showcase.id && pos.index > 0 && pos.index < scenes.length) return pos.index;
    } catch {
      /* stale value */
    }
    return 0;
  });
  /* Showcases open paused — play is a choice (space, click, or the
   * button), not an ambush. */
  const [paused, setPaused] = useState(true);
  const [progress, setProgress] = useState(0);
  /* Two presentations, matching the two exports: "screens" (App Screens —
   * titles on the slide, captions beside it) and "video" (TikTok — captions
   * over the media, no titles competing with them). */
  const [presentation, setPresentation] = useState<"screens" | "video">("screens");
  /* The canvas: portrait (TikTok / App Store) or the 4:3 embed rendition
   * (YouTube / desktop). Embed composes its own captions, so the
   * presentation toggle only applies to portrait. */
  const [canvas, setCanvas] = useState<"portrait" | "embed">("portrait");
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
  const indexRef = useRef(index);
  indexRef.current = index;

  useEffect(() => {
    const save = () =>
      sessionStorage.setItem(
        "player-resume",
        JSON.stringify({ id: showcase.id, index: indexRef.current }),
      );
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [showcase.id]);

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
      if (isTypingTarget(e)) return;
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

  return (
    <main
      /* A stage click only ever pauses — starting playback is always an
       * explicit choice (the play button or space), so the click that
       * focuses the window can't kick off the show. */
      onClick={() => setPaused(true)}
      className="relative flex h-dvh w-full flex-col select-none overflow-hidden"
      style={{ background: "var(--gradient-stage)" }}
    >
      {/* Persistent top-left Home, over the stage. */}
      <HomeBackNav />
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 pt-4 sm:flex-row sm:gap-4 md:gap-5">
        <div
          className={cn(
            "relative h-full min-h-0 shrink-0",
            canvas === "embed" && "overflow-hidden rounded-xl border border-border",
          )}
          style={{ aspectRatio: canvas === "embed" ? EMBED_ASPECT : FIXED_ASPECT }}
        >
          {canvas === "embed" ? (
            <EmbedSceneView key={scene.id} scene={scene} paused={paused} elapsedMs={elapsedMs} />
          ) : (
            <SceneView
              key={scene.id}
              scene={scene}
              paused={paused}
              elapsedMs={elapsedMs}
              /* The transcript column always shows the caption; the toggle
               * only decides whether it ALSO overlays the media. */
              hideCaption={presentation === "screens"}
              hideTitle={presentation === "video"}
            />
          )}
        </div>
        <div className="hidden shrink-0 flex-col self-stretch py-8 sm:flex sm:w-56 md:w-60 lg:w-64">
          {/* Scene identity, pinned to the top: how to refer to this
           * scene — in conversation and in the YAML (the id). The title
           * stays out; the slide itself displays it. */}
          <div className="shrink-0">
            {scene.eyebrow && (
              <p className="text-xs uppercase tracking-[0.42em] text-primary">{scene.eyebrow}</p>
            )}
            <p className="mt-2 font-mono text-[0.65rem] text-support">{scene.id}</p>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-4">
            {captionText && (
              <p
                key={captionText}
                className="caption-fade text-left text-lg leading-snug text-muted-foreground md:text-xl"
              >
                {captionText}
              </p>
            )}
            {scene.warnings && (
              <ul className="space-y-1.5 text-xs leading-relaxed text-amber-400/90">
                {scene.warnings.map((warning, i) => (
                  <li key={i}>⚠ {warning}</li>
                ))}
              </ul>
            )}
          </div>
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
          <Soundtrack
            paused={paused}
            soundtrack={showcase.soundtrack}
            timelineMs={
              scenes.slice(0, index).reduce((sum, s) => sum + s.durationMs, 0) + elapsedMs
            }
          />
          {canvas === "portrait" && (
            <Control
              label={
                presentation === "screens"
                  ? "Video presentation: overlay captions on the media, hide titles"
                  : "App Screens presentation: titles on the slide, captions in the transcript column only"
              }
              onClick={() => setPresentation((p) => (p === "screens" ? "video" : "screens"))}
            >
              {presentation === "screens" ? (
                <Columns2 className="size-4" />
              ) : (
                <Layers className="size-4" />
              )}
            </Control>
          )}
          <Control
            label={
              canvas === "portrait"
                ? "4:3 embed canvas (YouTube / desktop)"
                : "Portrait canvas (TikTok / App Store)"
            }
            onClick={() => setCanvas((c) => (c === "portrait" ? "embed" : "portrait"))}
          >
            {canvas === "portrait" ? (
              <RectangleHorizontal className="size-4" />
            ) : (
              <Smartphone className="size-4" />
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
        </div>
      </div>
      <DiagnosticsTray />
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
