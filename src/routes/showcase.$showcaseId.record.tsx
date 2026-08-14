import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createFileRoute } from "@tanstack/react-router";
import { getShowcase, type Scene, type Showcase } from "@/content/showcases";
import { FIXED_ASPECT, SceneView } from "@/components/showcase/SceneView";
import { collectSceneSources } from "@/components/showcase/useMediaPreload";

/* The whole showcase as a playable, phone-shaped frame with no device chrome
 * and no player controls. `scripts/export-video.mjs` opens this page to render
 * the showcase as a video (see that script for usage). Video presentation:
 * captions overlay the media and slide titles stay out of their way.
 *
 * The page drives itself through `window.__record`:
 *   ready    true once fonts are loaded and every image is decoded
 *   totalMs  sum of all scene durations
 *   start()  begin real-time playback (approach A: screen recording)
 *   seek(ms) jump to an exact moment — scenes, captions, and CSS animations
 *            all land on the frame for `ms` (approach B: frame-by-frame)
 *   done     true once playback (or a seek) reaches the end
 *
 * `?controlled=1` disables the real-time clock so `seek` fully owns time.
 */
export const Route = createFileRoute("/showcase/$showcaseId/record")({
  validateSearch: (search: Record<string, unknown>): { controlled: boolean } => ({
    controlled:
      search["controlled"] === 1 || search["controlled"] === "1" || search["controlled"] === true,
  }),
  head: ({ params }) => ({
    meta: [{ title: `Record — ${params.showcaseId}` }],
  }),
  component: RecordPage,
});

type RecordApi = {
  totalMs: number;
  ready: boolean;
  done: boolean;
  start: () => void;
  seek: (ms: number) => void;
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

/* CSS animations run on the document's real-time clock, so seeking the
 * showcase also has to seek every animation. Each one is pinned to the
 * virtual time at which it first appeared (i.e. when its element mounted),
 * then paused and scrubbed to `now - itsStart` on every frame. The same
 * treatment keeps <video> media in step. */
const animationStarts = new WeakMap<Animation, number>();
const videoStarts = new WeakMap<HTMLVideoElement, number>();

function scrubToVirtualTime(nowMs: number) {
  for (const animation of document.getAnimations()) {
    if (!animationStarts.has(animation)) animationStarts.set(animation, nowMs);
    animation.pause();
    animation.currentTime = nowMs - animationStarts.get(animation)!;
  }
  for (const video of document.querySelectorAll("video")) {
    if (!videoStarts.has(video)) videoStarts.set(video, nowMs);
    video.pause();
    const seconds = (nowMs - videoStarts.get(video)!) / 1000;
    video.currentTime = video.duration ? seconds % video.duration : seconds;
  }
}

function RecordPage() {
  const { showcaseId } = Route.useParams();
  const { controlled } = Route.useSearch();
  const showcase = getShowcase(showcaseId);
  if (!showcase) return null; // the layout route renders the not-found message
  return <Recorder showcase={showcase} controlled={controlled} />;
}

function Recorder({ showcase, controlled }: { showcase: Showcase; controlled: boolean }) {
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

  useEffect(() => {
    const api: RecordApi = {
      totalMs,
      ready: false,
      done: false,
      start: () => setClock((c) => ({ ...c, started: true })),
      seek: (ms: number) => {
        const next = clockAt(scenes, ms);
        flushSync(() => setClock(next));
        scrubToVirtualTime(ms);
        api.done = next.done;
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
  return (
    <main className="flex h-dvh w-full items-center justify-center overflow-hidden bg-background">
      <div className="relative h-full max-w-full" style={{ aspectRatio: FIXED_ASPECT }}>
        <SceneView
          key={scene.id}
          scene={scene}
          paused={controlled ? true : !clock.started}
          mode="fixed-overlay"
          elapsedMs={clock.elapsedMs}
          frameless
          hideTitle
        />
      </div>
    </main>
  );
}
