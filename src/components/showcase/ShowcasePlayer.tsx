import { useCallback, useEffect, useRef, useState } from "react";
import {
  Captions,
  CaptionsOff,
  Pause,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { ShowcaseNav } from "./ShowcaseNav";
import { DiagnosticsTray } from "./DiagnosticsTray";
import { cn } from "@/lib/utils";
import { isTypingTarget } from "@/lib/typing-target";
import { commitEdit, useCanEditScenes, useEditShortcuts } from "@/lib/edits";
import { EditableText } from "@/components/studio/EditableText";
import { ExportButton } from "@/components/studio/ExportButton";
import { MediaPicker } from "@/components/studio/MediaPicker";
import { StylePanel } from "@/components/studio/StylePanel";
import { captionTimeline, type Showcase } from "@/content/showcases";
import { embedCaptionsSetting } from "@/content/embed-captions";
import { playerView, VIEW_LABELS, type PlayerView } from "@/lib/export-kinds.mjs";
import { FIXED_ASPECT, SceneView, TIKTOK_ASPECT } from "./SceneView";
import { EMBED_ASPECT, EmbedSceneView } from "./EmbedSceneView";
import { ProgressRail } from "./ProgressRail";
import { StageControls } from "./StageControls";
import { Scrubber } from "./Scrubber";
import { Soundtrack } from "./Soundtrack";
import { useMediaPreload } from "./useMediaPreload";

/** The view this browser last used, as a fallback for a showcase that
 *  names none. */
const rememberedView = (): PlayerView | null => {
  try {
    return typeof window === "undefined" ? null : playerView(localStorage.getItem("player-view"));
  } catch {
    return null;
  }
};

export function ShowcasePlayer({
  showcase,
  initialView,
}: {
  showcase: Showcase;
  /** The view the page's URL asks for (?view=), which wins over the
   *  showcase's own meta.view. */
  initialView?: PlayerView | undefined;
}) {
  const scenes = showcase.scenes;
  useMediaPreload(scenes);
  /* Live reload (the studio watcher reloads the page on every file save)
   * must not lose the viewer's place: the slide AND the view mode are
   * saved in beforeunload — which only fires on real page reloads, never
   * on in-app navigation — and consumed once here, so opening a showcase
   * fresh still starts at the top in TikTok view. */
  const [resume] = useState<{ id: string; index?: number; view?: string } | null>(() => {
    if (typeof window === "undefined") return null;
    const saved = sessionStorage.getItem("player-resume");
    if (!saved) return null;
    sessionStorage.removeItem("player-resume");
    try {
      const pos = JSON.parse(saved) as { id: string; index?: number; view?: string };
      return pos.id === showcase.id ? pos : null;
    } catch {
      return null; /* stale value */
    }
  });
  const [index, setIndex] = useState(() =>
    resume?.index != null && resume.index > 0 && resume.index < scenes.length ? resume.index : 0,
  );
  /* Showcases open paused — play is a choice (space, click, or the
   * button), not an ambush. */
  const [paused, setPaused] = useState(true);
  const [progress, setProgress] = useState(0);
  /* Three exclusive view modes, each previewing an export destination:
   * "tiktok" (TikTok's 9:16 frame, captions overlaid, titles hidden —
   * the default: it's the finished-video look), "screens" (App Screens —
   * the 1320×2868 App Store canvas, titles on the slide, captions
   * beside), and "embed" (the 4:3 canvas for YouTube/desktop, which
   * composes its own captions). The view to open in, first one wins: the
   * place a live reload saved, the URL's ?view=, the showcase's own
   * meta.view (the pin button beside the switch writes it), the view this
   * browser last used, TikTok. */
  const [view, setView] = useState<PlayerView>(
    () => playerView(resume?.view) ?? initialView ?? showcase.view ?? rememberedView() ?? "tiktok",
  );
  const pickView = (next: PlayerView) => {
    setView(next);
    try {
      localStorage.setItem("player-view", next);
    } catch {
      /* storage unavailable — the switch still works for this page */
    }
  };
  /* The pin: this view is the one the showcase opens in (meta.view). */
  const pinned = showcase.view === view;
  const canvas = view === "embed" ? "embed" : view === "tiktok" ? "tiktok" : "portrait";
  /* TikTok view: shade where TikTok's own interface will sit. A viewer
   * preference, remembered in this browser only. */
  const [safeArea, setSafeArea] = useState(() => {
    try {
      return typeof window !== "undefined" && localStorage.getItem("tiktok-safe-area") === "1";
    } catch {
      return false;
    }
  });
  const toggleSafeArea = () =>
    setSafeArea((on) => {
      try {
        localStorage.setItem("tiktok-safe-area", on ? "0" : "1");
      } catch {
        /* storage unavailable — the switch still works for this page */
      }
      return !on;
    });
  /* Overlay captions on the 4:3 canvas: showcase.yaml's embedCaptions, or
   * the voiceover-based default. The 4:3 toggle below writes it. */
  const embedCaptions = embedCaptionsSetting(showcase);
  const presentation = view === "tiktok" ? "video" : "screens";
  const scene = scenes[index] ?? scenes[0]!;

  /* Studio editing: pause to edit. While paused in the App Screens view,
   * the slide's title is click-to-edit and the media area opens the asset
   * picker; edits apply to the model in place (no reload, no flash) while
   * the shell writes them into showcase.yaml. Cmd/Ctrl+Z undoes. */
  const canEdit = useCanEditScenes();
  useEditShortcuts(showcase.id);
  const editing = canEdit && paused && view === "screens";
  const [picker, setPicker] = useState(false);

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
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    const save = () =>
      sessionStorage.setItem(
        "player-resume",
        JSON.stringify({ id: showcase.id, index: indexRef.current, view: viewRef.current }),
      );
    window.addEventListener("beforeunload", save);
    return () => window.removeEventListener("beforeunload", save);
  }, [showcase.id]);

  /* Time into the current scene: the clock below advances it, and the
   * scrubber sets it (seek), which also pauses the show. */
  const elapsedRef = useRef(0);
  /* The stage's media — videos and CSS animations (motion, overlays,
   * diagrams) — runs on its own clock from when the scene mounted, so a
   * seek moves those to the new moment too. */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const seek = useCallback(
    (ms: number) => {
      /* Scrubbing stops the show where it lands. */
      setPaused(true);
      const offset = Math.min(Math.max(0, ms), scene.durationMs);
      elapsedRef.current = offset;
      setProgress(offset / scene.durationMs);
      const root = stageRef.current;
      if (!root) return;
      for (const animation of root.getAnimations({ subtree: true })) {
        animation.currentTime = offset;
      }
      for (const video of root.querySelectorAll("video")) {
        const place = () => {
          const seconds = offset / 1000;
          video.currentTime = video.duration ? seconds % video.duration : seconds;
        };
        if (video.readyState >= 1) place();
        else video.addEventListener("loadedmetadata", place, { once: true });
      }
    },
    [scene.durationMs],
  );

  useEffect(() => {
    let raf = 0;
    elapsedRef.current = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      if (!pausedRef.current) {
        elapsedRef.current += delta;
        const ratio = Math.min(elapsedRef.current / scene.durationMs, 1);
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
      /* While the media picker is open the scene must not move — a
       * thumbnail click writes to the scene it was opened for. */
      if (picker || isTypingTarget(e)) return;
      if (e.key === " ") {
        e.preventDefault();
        setPaused((p) => !p);
      }
      if (e.key === "ArrowRight") advanceRef.current();
      if (e.key === "ArrowLeft") go(Math.max(0, index - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, go, picker]);

  const elapsedMs = progress * scene.durationMs;
  /* One timeline pass gives both the caption on screen and its index —
   * the transcript column edits that same line in place while paused
   * (the /script page lists and edits all of them). Deriving both from
   * the same entry keeps the displayed text and the edited YAML line in
   * lockstep. */
  const timeline = captionTimeline(scene);
  const captionIndex = (() => {
    const active = timeline.findIndex((entry) => elapsedMs < entry.endMs);
    return active >= 0 ? active : timeline.length - 1;
  })();
  const caption = captionIndex >= 0 ? timeline[captionIndex] : undefined;
  const captionText = caption?.text ?? scene.body;

  return (
    <main
      /* Stage clicks don't touch playback — pausing is as explicit as
       * playing (the pause button or space), so stray clicks while the
       * show runs can't stop it. */
      className="relative flex h-dvh w-full flex-col select-none overflow-hidden"
      style={{ background: "var(--gradient-stage)" }}
    >
      {/* The tab bar takes the first row; the stage fills the rest. */}
      <ShowcaseNav
        showcaseId={showcase.id}
        title={showcase.title}
        current="player"
        built={showcase.builtMedia}
      />
      <div
        ref={stageRef}
        className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 pt-4 sm:flex-row sm:gap-4 md:gap-5"
      >
        {canvas === "embed" ? (
          /* The embed canvas composes its own captions, so no transcript
           * column — the scene identity sits in a strip above the frame.
           * The stage's width derives from a definite height (as the
           * portrait stage does); aspect-ratio on a flex-sized box
           * collapses instead. */
          <div className="flex h-full min-h-0 flex-col justify-center">
            <div className="flex h-7 shrink-0 items-baseline gap-4 px-1">
              {scene.eyebrow && (
                <p className="text-xs uppercase tracking-[0.42em] text-primary">{scene.eyebrow}</p>
              )}
              <p className="font-mono text-[0.65rem] text-support">{scene.id}</p>
              {scene.warnings?.map((warning, i) => (
                <p key={i} className="text-xs text-amber-400/90">
                  ⚠ {warning}
                </p>
              ))}
            </div>
            <div
              className="relative overflow-hidden rounded-xl border border-border"
              style={{ height: "calc(100% - 1.75rem)", aspectRatio: EMBED_ASPECT }}
            >
              <EmbedSceneView
                key={scene.id}
                scene={scene}
                paused={paused}
                elapsedMs={elapsedMs}
                captions={embedCaptions.shown}
              />
            </div>
          </div>
        ) : (
          <>
            <div
              className="relative h-full min-h-0 shrink-0"
              style={{ aspectRatio: canvas === "tiktok" ? TIKTOK_ASPECT : FIXED_ASPECT }}
            >
              <SceneView
                key={scene.id}
                scene={scene}
                paused={paused}
                elapsedMs={elapsedMs}
                canvas={canvas === "tiktok" ? "tiktok" : "portrait"}
                safeArea={canvas === "tiktok" && safeArea}
                /* The transcript column always shows the caption; the toggle
                 * only decides whether it ALSO overlays the media. */
                hideCaption={presentation === "screens"}
                hideTitle={presentation === "video"}
                onEditTitle={
                  editing && scene.theme !== "footage"
                    ? (value) => void commitEdit(showcase.id, scene.id, { field: "title", value })
                    : undefined
                }
                onPickMedia={
                  editing && (scene.media.kind === "image" || scene.media.kind === "video")
                    ? () => setPicker(true)
                    : undefined
                }
              />
            </div>
            <div className="hidden shrink-0 flex-col self-stretch py-8 sm:flex sm:w-56 md:w-60 lg:w-64">
              {/* Scene identity, pinned to the top: how to refer to this
               * scene — in conversation and in the YAML (the id). The title
               * stays out; the slide itself displays it. */}
              <div className="shrink-0">
                {scene.eyebrow && (
                  <p className="text-xs uppercase tracking-[0.42em] text-primary">
                    {scene.eyebrow}
                  </p>
                )}
                <p className="mt-2 font-mono text-[0.65rem] text-support">{scene.id}</p>
              </div>
              <div className="flex flex-1 flex-col justify-center gap-4">
                {captionText && (
                  <p
                    key={captionText}
                    className="caption-fade text-left text-lg leading-snug text-muted-foreground md:text-xl"
                  >
                    {canEdit && paused && captionIndex >= 0 ? (
                      <EditableText
                        value={captionText}
                        onCommit={(value) =>
                          void commitEdit(showcase.id, scene.id, {
                            field: "caption",
                            captionIndex,
                            value,
                          })
                        }
                        label="Click to edit this caption"
                      />
                    ) : (
                      captionText
                    )}
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
          </>
        )}
      </div>

      {/* Rendering and playback controls — between the stage and the
       * scene rail: the scrubber first, right under the stage, then the
       * current view's own controls (the TikTok view's safe area and
       * picture fit). Future ones (playback speed) go here too. */}
      <div className="flex shrink-0 justify-center">
        <Scrubber positionMs={elapsedMs} durationMs={scene.durationMs} onSeek={seek} />
      </div>
      <StageControls
        showcaseId={showcase.id}
        scene={scene}
        view={view}
        canEdit={canEdit}
        safeArea={safeArea}
        onToggleSafeArea={toggleSafeArea}
        atMs={scenes.slice(0, index).reduce((sum, s) => sum + s.durationMs, 0) + elapsedMs}
      />
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
        <div className="flex items-center gap-6 text-muted-foreground">
          {/* View mode: which export destination this screen previews. */}
          <div className="flex rounded-full border border-border bg-card/60 p-1 text-xs">
            {(
              [
                ["tiktok", "TikTok"],
                ["screens", "App Screens"],
                ["embed", "4:3"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => pickView(key)}
                aria-pressed={view === key}
                className={cn(
                  "rounded-full px-3 py-1.5 transition-colors",
                  view === key
                    ? "bg-secondary text-foreground"
                    : "text-support hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
            {/* The pin: open this showcase in the current view from now
             * on (meta.view in showcase.yaml, through the usual edit path,
             * so the change log and git history see it); pinned, it
             * unpins back to TikTok, the built-in default. */}
            {canEdit && (
              <button
                type="button"
                aria-pressed={pinned}
                aria-label={
                  pinned
                    ? `${VIEW_LABELS[view]} is the view this showcase opens in. Click to go back to opening in TikTok view.`
                    : `Open this showcase in the ${VIEW_LABELS[view]} view from now on`
                }
                title={
                  pinned
                    ? `This showcase opens in the ${VIEW_LABELS[view]} view (saved in showcase.yaml). Click to go back to the default, TikTok.`
                    : `Open this showcase in the ${VIEW_LABELS[view]} view from now on (saved in showcase.yaml)`
                }
                onClick={() =>
                  void commitEdit(showcase.id, "", {
                    field: "meta.set",
                    name: "view",
                    value: pinned ? null : view,
                  })
                }
                className={cn(
                  "ml-1 rounded-full px-2 py-1.5 transition-colors",
                  pinned ? "text-primary" : "text-support hover:text-foreground",
                )}
              >
                {pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
              </button>
            )}
          </div>
          {/* 4:3 captions: whether the embed canvas overlays them. "auto"
           * follows the voiceover; picking a value writes meta.embedCaptions
           * to showcase.yaml, and the reset removes it again. */}
          {view === "embed" && canEdit && (
            <div className="flex items-center rounded-full border border-border bg-card/60 p-1 text-xs">
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
                Captions {embedCaptions.shown ? "on" : "off"}
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
          {/* Transport. */}
          <div className="flex items-center gap-2">
            <Control label="Previous scene" onClick={() => go(Math.max(0, index - 1))}>
              <SkipBack className="size-4" />
            </Control>
            <Control label={paused ? "Play" : "Pause"} onClick={() => setPaused((p) => !p)} primary>
              {paused ? <Play className="size-4" /> : <Pause className="size-4" />}
            </Control>
            <Control label="Next scene" onClick={() => advanceRef.current()}>
              <SkipForward className="size-4" />
            </Control>
            {showcase.soundtrack && (
              <Soundtrack
                paused={paused}
                soundtrack={showcase.soundtrack}
                timelineMs={
                  scenes.slice(0, index).reduce((sum, s) => sum + s.durationMs, 0) + elapsedMs
                }
              />
            )}
            {canEdit && <StylePanel showcase={showcase} />}
            {/* Exports what this view previews (TikTok, 4:3, App Screens). */}
            <ExportButton showcaseId={showcase.id} view={view} />
          </div>
        </div>
      </div>
      {picker && <MediaPicker showcase={showcase} scene={scene} onClose={() => setPicker(false)} />}
      <DiagnosticsTray />
    </main>
  );
}

function Control({
  label,
  onClick,
  children,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  /** Filled primary marks the transport's main action (play/pause);
   *  the quiet outline is for the secondary controls around it. */
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "rounded-full p-2.5 transition-colors",
        primary
          ? "border border-transparent bg-primary text-primary-foreground hover:bg-primary/85"
          : "border border-border bg-card/60 text-foreground/70 hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
