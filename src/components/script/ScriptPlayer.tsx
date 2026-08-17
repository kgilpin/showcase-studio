import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  Circle,
  Minus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Square,
  Video,
  VideoOff,
  X,
} from "lucide-react";
import { captionTimeline, type Scene } from "@/content/showcases";
import { collectSceneSources } from "@/components/showcase/useMediaPreload";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/lib/typing-target";

type Props = {
  scenes: Scene[];
  onExit: () => void;
  record?: boolean;
  /** File-name stem for camera takes (usually the showcase id). */
  takeName?: string;
};

/* The same recording API the /record route exposes (declared there). In
 * record mode the prompter starts paused, drives itself through
 * window.__record, plays once instead of looping, and flags `done` at the
 * end — so scripts/export-video.mjs can capture it like any showcase. */
type RecordApi = NonNullable<Window["__record"]>;

type Line = {
  key: string;
  kind: "caption" | "support";
  text: string;
  eyebrow?: string | undefined;
  sceneIndex: number;
  startMs: number;
  endMs: number;
};

/** Flattens every slide into one continuous, time-coded script.
 *
 * Only lines the narrator actually reads make it in: captions and support.
 * Titles are on-screen text and stay out of the prompter; the scene's
 * eyebrow is kept as a section label over the scene's first line. */
function buildLines(scenes: Scene[]): Line[] {
  const lines: Line[] = [];
  let offset = 0;
  scenes.forEach((scene, sceneIndex) => {
    const timeline = captionTimeline(scene);
    const sceneLineStart = lines.length;
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
    const first = lines[sceneLineStart];
    if (scene.eyebrow && first) first.eyebrow = scene.eyebrow;
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
export function ScriptPlayer({ scenes, onExit, record = false, takeName = "script" }: Props) {
  const lines = useMemo(() => buildLines(scenes), [scenes]);
  const total = useMemo(() => scenes.reduce((s, x) => s + x.durationMs, 0), [scenes]);
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(!record);
  /* Reading-speed multiplier on the script clock: 1.2 means the windows
   * pass 20% faster than the showcase's real timing. */
  const [speed, setSpeed] = useState(1);
  /* Extra real-time dwell on the current line ("+1s"): the clock stands
   * still until this drains, stretching the line without pausing. */
  const holdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const last = useRef<number | null>(null);

  const jumpTo = useCallback((ms: number) => {
    holdRef.current = 0;
    setElapsed(ms);
  }, []);

  const jumpToNextLine = useCallback(() => {
    holdRef.current = 0;
    setElapsed((e) => lines.find((line) => line.startMs > e)?.startMs ?? e);
  }, [lines]);

  /* Camera capture: film the narrator (camera + mic) while they read.
   * Recording restarts the script behind a short countdown, stops when the
   * script ends (or on demand), and downloads the take as a video file. */
  const [camera, setCamera] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const takeCount = useRef(0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const taking = recording || countdown != null;
  const takingRef = useRef(false);
  takingRef.current = taking;

  const stopTake = useCallback(() => {
    setCountdown(null);
    setRecording(false);
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    setPlaying(false);
  }, []);

  const toggleCamera = useCallback(async () => {
    if (camera) {
      stopTake();
      camera.getTracks().forEach((track) => track.stop());
      setCamera(null);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: true,
      });
      setCameraError(null);
      setCamera(stream);
    } catch {
      setCameraError("Camera unavailable — check the browser's camera and mic permissions.");
    }
  }, [camera, stopTake]);

  const startTake = useCallback(() => {
    if (!camera || takingRef.current) return;
    setPlaying(false);
    holdRef.current = 0;
    setElapsed(0);
    setCountdown(3);
  }, [camera]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = camera;
  }, [camera]);

  // Release the camera when it changes or the prompter unmounts.
  useEffect(() => () => camera?.getTracks().forEach((track) => track.stop()), [camera]);

  useEffect(() => {
    if (countdown == null || camera == null) return;
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
    // Countdown finished: roll the camera, then start the script.
    const mimeType = ["video/mp4", "video/webm;codecs=vp9,opus", "video/webm"].find((m) =>
      MediaRecorder.isTypeSupported(m),
    );
    const recorder = new MediaRecorder(camera, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      if (chunks.length === 0) return;
      takeCount.current += 1;
      const extension = recorder.mimeType.includes("mp4") ? "mp4" : "webm";
      const url = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${takeName}-take-${takeCount.current}.${extension}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };
    recorder.start();
    recorderRef.current = recorder;
    setCountdown(null);
    setRecording(true);
    setPlaying(true);
    return undefined;
  }, [countdown, camera, takeName]);

  // A take ends with the script: stop and save instead of looping.
  useEffect(() => {
    if (recording && elapsed >= total) stopTake();
  }, [recording, elapsed, total, stopTake]);

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
      if (holdRef.current > 0) {
        // A "+1s" hold: real time passes but the script clock stands still.
        holdRef.current = Math.max(0, holdRef.current - dt);
      } else {
        const step = dt * speed;
        // Record mode and camera takes play once and hold at the end; live
        // mode loops.
        setElapsed((e) =>
          e + step >= total ? (record || takingRef.current ? total : 0) : e + step,
        );
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      last.current = null;
    };
  }, [playing, total, record, speed]);

  useEffect(() => {
    if (!record || elapsed < total) return;
    setPlaying(false);
    if (window.__record) window.__record.done = true;
  }, [record, elapsed, total]);

  useEffect(() => {
    if (!record) return;
    const api: RecordApi = {
      totalMs: total,
      ready: false,
      done: false,
      start: () => setPlaying(true),
      seek: (ms: number) => {
        flushSync(() => setElapsed(Math.min(ms, total)));
        api.done = ms >= total;
      },
    };
    window.__record = api;

    void (async () => {
      await document.fonts.ready;
      await Promise.all(
        collectSceneSources(scenes).map(({ src, kind }) => {
          if (kind !== "image") return undefined;
          const img = new Image();
          img.src = src;
          return img.decode().catch(() => undefined);
        }),
      );
      api.ready = true;
    })();

    return () => {
      delete window.__record;
    };
  }, [record, scenes, total]);

  /* Keep the reading spot pinned near the top of the scroll area. The
   * scroll glides continuously: within a line's window it interpolates
   * toward the next line's position, so the text streams past the pin
   * instead of jumping when the line changes. */
  useEffect(() => {
    const container = scrollRef.current;
    const el = lineRefs.current[active.key];
    if (!container || !el) return;
    const next = lines[activeIndex + 1];
    const nextEl = next ? lineRefs.current[next.key] : null;
    const span = active.endMs - active.startMs;
    const fraction = span > 0 ? Math.min(1, Math.max(0, (elapsed - active.startMs) / span)) : 0;
    const top = el.offsetTop + (nextEl ? (nextEl.offsetTop - el.offsetTop) * fraction : 0);
    container.scrollTop = top - container.clientHeight * 0.18;
  }, [elapsed, active.key, active.startMs, active.endMs, activeIndex, lines]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e)) return;
      if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "ArrowRight") jumpToNextLine();
      else if (e.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit, jumpToNextLine]);

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
          {camera && (
            <div className="relative mb-6 overflow-hidden rounded-2xl border border-border bg-card">
              {/* Mirrored like a phone selfie view so the narrator can frame
               * themselves; the recording itself is not mirrored. */}
              <video ref={previewRef} autoPlay muted playsInline className="w-full -scale-x-100" />
              {recording && (
                <span className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-background/70 px-2.5 py-1 text-xs text-foreground">
                  <span className="size-2 animate-pulse rounded-full bg-red-500" /> REC
                </span>
              )}
            </div>
          )}
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
          className="relative min-w-0 flex-1 overflow-y-auto [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_70%,transparent)]"
          /* Reading text, not showcase branding: a plain high-legibility
           * sans stack instead of the theme's display font. */
          style={{
            fontFamily:
              "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
          }}
        >
          {/* Narrow reading column: short lines keep the eyes near the pin
           * instead of scanning the full window width. */}
          <ul className="mx-auto w-full max-w-2xl space-y-6 pb-[60vh] pt-6">
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
                  onClick={() => jumpTo(line.startMs)}
                  title="Jump to this line"
                  className={cn(
                    "flex cursor-pointer gap-5 transition-all duration-500",
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
                    {line.eyebrow && (
                      <p className="mb-2 text-xs uppercase tracking-[0.42em] text-primary">
                        {line.eyebrow}
                      </p>
                    )}
                    {line.kind === "support" ? (
                      <p className="text-lg leading-relaxed text-muted-foreground sm:text-xl">
                        {line.text}
                      </p>
                    ) : (
                      /* Active emphasis via transform, not font size: a size
                       * change reflows the list and makes the pinned scroll
                       * position jump at every line change. Scale doesn't
                       * touch layout, so the glide stays seamless. */
                      <p
                        className={cn(
                          "origin-left text-2xl leading-snug transition-[transform,color] duration-300 sm:text-3xl",
                          isActive
                            ? "scale-105 text-foreground sm:scale-110"
                            : "text-muted-foreground",
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

      {countdown != null && countdown > 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <p className="font-display text-9xl text-foreground">{countdown}</p>
        </div>
      )}

      <div className="flex items-center justify-center gap-4 border-t border-border px-6 py-4">
        <button
          type="button"
          onClick={() => jumpTo(0)}
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
        <button
          type="button"
          onClick={jumpToNextLine}
          aria-label="Jump to the next line"
          className="rounded-full border border-border p-2 text-support transition-colors hover:text-foreground"
        >
          <SkipForward className="size-4" />
        </button>
        <div className="flex items-center gap-1 rounded-full border border-border px-1.5 py-1">
          <button
            type="button"
            onClick={() => setSpeed((s) => Math.max(0.5, Math.round((s - 0.1) * 10) / 10))}
            aria-label="Read slower"
            className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-9 text-center text-xs tabular-nums text-muted-foreground">
            {speed.toFixed(1)}×
          </span>
          <button
            type="button"
            onClick={() => setSpeed((s) => Math.min(2, Math.round((s + 0.1) * 10) / 10))}
            aria-label="Read faster"
            className="rounded-full p-1.5 text-support transition-colors hover:text-foreground"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => (holdRef.current += 1000)}
          aria-label="Hold this line for one more second"
          className="rounded-full border border-border px-3 py-2 text-xs tabular-nums text-support transition-colors hover:text-foreground"
        >
          +1s
        </button>
        {!record && (
          <button
            type="button"
            onClick={() => void toggleCamera()}
            aria-label={camera ? "Turn the camera off" : "Turn the camera on to film a take"}
            className="rounded-full border border-border p-2 text-support transition-colors hover:text-foreground"
          >
            {camera ? <VideoOff className="size-4" /> : <Video className="size-4" />}
          </button>
        )}
        {!record && camera && (
          <button
            type="button"
            onClick={taking ? stopTake : startTake}
            aria-label={taking ? "Stop recording and save the take" : "Record a take from the top"}
            className="rounded-full border border-border p-2 transition-colors hover:bg-card"
          >
            {taking ? (
              <Square className="size-4 fill-red-500 text-red-500" />
            ) : (
              <Circle className="size-4 fill-red-500 text-red-500" />
            )}
          </button>
        )}
        {cameraError && <p className="text-xs text-support">{cameraError}</p>}
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
