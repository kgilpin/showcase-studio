import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createFileRoute } from "@tanstack/react-router";
import {
  activeCaption,
  captionTimeline,
  getShowcase,
  type Scene,
  type Showcase,
} from "@/content/showcases";
import { embedCaptionsSetting } from "@/content/embed-captions";
import { SceneView, TIKTOK_ASPECT } from "@/components/showcase/SceneView";
import { EMBED_ASPECT, EmbedSceneView } from "@/components/showcase/EmbedSceneView";
import { collectSceneSources } from "@/components/showcase/useMediaPreload";
import { seekSceneMedia } from "@/lib/record-seek";

/* The whole showcase as a playable 9:16 TikTok frame with no device chrome
 * and no player controls. `scripts/export-video.mjs` opens this page to render
 * the showcase as a video (see that script for usage). Video presentation:
 * captions overlay the media and slide titles stay out of their way.
 *
 * The page drives itself through `window.__record`:
 *   ready    true once fonts are loaded and every image is decoded
 *   totalMs  sum of all scene durations
 *   start()  begin real-time playback (approach A: screen recording)
 *   seek(ms) jump to an exact moment — scenes, captions, and CSS animations
 *            all land on the frame for `ms`, whatever was seeked before
 *            (approach B: frame-by-frame; src/lib/record-seek.ts)
 *   done     true once playback (or a seek) reaches the end
 *   at()     what the frame shows now: the scene and the caption on it
 *            (the screenshot_frame tool names them under each image)
 *
 * `?controlled=1` disables the real-time clock so `seek` fully owns time.
 * `?canvas=embed` renders the 4:3 embed canvas (EmbedSceneView) instead
 * of the TikTok frame. (`?canvas=portrait`, from before the TikTok frame
 * was 9:16, means the TikTok frame too.) `?safeArea=1` shades where
 * TikTok's own interface covers the frame, as the player's Safe area
 * switch does — for a frame someone checks, never for an export.
 */
export const Route = createFileRoute("/showcase/$showcaseId/record")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    controlled: boolean;
    canvas: "tiktok" | "embed";
    safeArea: boolean;
    snapshot?: string;
  } => ({
    controlled: flag(search["controlled"]),
    canvas: search["canvas"] === "embed" ? "embed" : "tiktok",
    safeArea: flag(search["safeArea"]),
    /* The export's snapshot of the showcase (src/content/source.ts reads
     * it from the URL); kept here so the router keeps it in the URL. */
    ...(typeof search["snapshot"] === "string" ? { snapshot: search["snapshot"] } : {}),
  }),
  head: ({ params }) => ({
    meta: [{ title: `Record — ${params.showcaseId}` }],
  }),
  component: RecordPage,
});

/** A `?flag=1` search parameter. */
const flag = (value: unknown) => value === 1 || value === "1" || value === true;

/** A box in the frame, in percent of the frame from its top-left corner. */
export type FrameBox = { top: number; left: number; width: number; height: number };

/** What the frame shows at the current moment. */
export type FrameInfo = {
  scene: { id: string; index: number; count: number; elapsedMs: number; durationMs: number };
  /** The caption on the frame, when the scene has captions, with the box
   *  its chip takes up when it is drawn on the frame (the caption-over-
   *  face check compares it with the faces it finds). */
  caption?: { index: number; count: number; text: string; box?: FrameBox };
};

type RecordApi = {
  totalMs: number;
  ready: boolean;
  done: boolean;
  start: () => void;
  seek: (ms: number) => void;
  /** The scene and caption on the frame now (this page only; the
   *  teleprompter's recorder doesn't have it). */
  at?: () => FrameInfo;
};

declare global {
  interface Window {
    __record?: RecordApi;
  }
}

type Clock = { index: number; elapsedMs: number; started: boolean; done: boolean };

/** Which scene, and how far into it, the showcase is at `ms` from the start. */
function clockAt(scenes: Scene[], ms: number): Clock {
  let remaining = ms;
  for (let i = 0; i < scenes.length; i++) {
    const duration = scenes[i]!.durationMs;
    if (remaining < duration) return { index: i, elapsedMs: remaining, started: true, done: false };
    remaining -= duration;
  }
  const last = scenes.length - 1;
  return { index: last, elapsedMs: scenes[last]!.durationMs, started: true, done: true };
}

/** Where `element` sits in `frame`, in percent of the frame. */
function boxIn(frame: HTMLElement, element: Element): FrameBox | undefined {
  const outer = frame.getBoundingClientRect();
  const inner = element.getBoundingClientRect();
  if (!outer.width || !outer.height) return undefined;
  const percent = (value: number, of: number) => Math.round((value / of) * 1000) / 10;
  return {
    top: percent(inner.top - outer.top, outer.height),
    left: percent(inner.left - outer.left, outer.width),
    width: percent(inner.width, outer.width),
    height: percent(inner.height, outer.height),
  };
}

/** The scene and caption a clock points at. */
function frameInfo(scenes: Scene[], clock: Clock, frame: HTMLElement | null): FrameInfo {
  const scene = scenes[clock.index] ?? scenes[0]!;
  const info: FrameInfo = {
    scene: {
      id: scene.id,
      index: clock.index,
      count: scenes.length,
      elapsedMs: Math.round(clock.elapsedMs),
      durationMs: scene.durationMs,
    },
  };
  const caption = activeCaption(scene, clock.elapsedMs);
  if (caption) {
    const timeline = captionTimeline(scene);
    info.caption = {
      index: timeline.findIndex((entry) => entry.startMs === caption.startMs),
      count: timeline.length,
      text: caption.text,
    };
    const chip = frame?.querySelector(".caption-chip");
    const box = frame && chip ? boxIn(frame, chip) : undefined;
    if (box) info.caption.box = box;
  }
  return info;
}

function RecordPage() {
  const { showcaseId } = Route.useParams();
  const { controlled, canvas, safeArea } = Route.useSearch();
  const showcase = getShowcase(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message
  return (
    <Recorder showcase={showcase} controlled={controlled} canvas={canvas} safeArea={safeArea} />
  );
}

function Recorder({
  showcase,
  controlled,
  canvas,
  safeArea,
}: {
  showcase: Showcase;
  controlled: boolean;
  canvas: "tiktok" | "embed";
  safeArea: boolean;
}) {
  const scenes = showcase.scenes;
  const totalMs = scenes.reduce((sum, scene) => sum + scene.durationMs, 0);
  const [clock, setClock] = useState<Clock>({
    index: 0,
    elapsedMs: 0,
    started: false,
    done: false,
  });
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const frameRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const api: RecordApi = {
      totalMs,
      ready: false,
      done: false,
      start: () => setClock((c) => ({ ...c, started: true })),
      seek: (ms: number) => {
        const next = clockAt(scenes, ms);
        flushSync(() => setClock(next));
        seekSceneMedia(document, scenes[next.index]!, next.elapsedMs);
        api.done = next.done;
      },
      at: () => frameInfo(scenes, clockRef.current, frameRef.current),
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
  }, [scenes, totalMs]);

  // Real-time playback (approach A). In controlled mode, `seek` owns time.
  useEffect(() => {
    if (controlled) return;
    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      const c = clockRef.current;
      if (c.started && !c.done) {
        const elapsed = c.elapsedMs + delta;
        const scene = scenes[c.index]!;
        if (elapsed >= scene.durationMs) {
          if (c.index + 1 < scenes.length) {
            setClock({ ...c, index: c.index + 1, elapsedMs: 0 });
          } else {
            setClock({ ...c, elapsedMs: scene.durationMs, done: true });
            if (window.__record) window.__record.done = true;
          }
        } else {
          setClock({ ...c, elapsedMs: elapsed });
        }
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [controlled, scenes]);

  const scene = scenes[clock.index] ?? scenes[0]!;
  const paused = controlled ? true : !clock.started;
  return (
    <main className="flex h-dvh w-full items-center justify-center overflow-hidden bg-background">
      <div
        ref={frameRef}
        className="relative h-full max-w-full"
        style={{ aspectRatio: canvas === "embed" ? EMBED_ASPECT : TIKTOK_ASPECT }}
      >
        {canvas === "embed" ? (
          <EmbedSceneView
            key={scene.id}
            scene={scene}
            paused={paused}
            elapsedMs={clock.elapsedMs}
            captions={embedCaptionsSetting(showcase).shown}
          />
        ) : (
          <SceneView
            key={scene.id}
            scene={scene}
            paused={paused}
            elapsedMs={clock.elapsedMs}
            canvas="tiktok"
            frameless
            hideTitle
            safeArea={safeArea}
          />
        )}
      </div>
    </main>
  );
}
