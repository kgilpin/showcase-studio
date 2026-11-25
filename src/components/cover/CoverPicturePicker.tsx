import { useEffect, useMemo, useRef, useState } from "react";
import { Film, ImagePlus, Images, Loader2, X } from "lucide-react";
import { refreshShowcase, showcaseAssets, type Scene, type Showcase } from "@/content/showcases";
import { SceneView, TIKTOK_ASPECT } from "@/components/showcase/SceneView";
import { EMBED_ASPECT, EmbedSceneView } from "@/components/showcase/EmbedSceneView";
import { forgetEditBase } from "@/lib/edits";
import { clipTimeS, seekSceneMedia } from "@/lib/record-seek";
import { studio } from "@/lib/studio";
import { cn } from "@/lib/utils";

/* Choosing the cover's picture, from either place a picture comes from:
 *
 *   From the video   scrub through the whole video. Two ways to take a
 *                    moment:
 *                      Picture      the scene's own picture (no captions,
 *                                   no brand mark). "Use this frame"
 *                                   saves the clip's frame into assets/;
 *                                   on a scene with an image, the image
 *                                   is picked.
 *                      Whole scene  the slide as the video draws it, for
 *                                   a scene that is text or a graphic.
 *                                   Title, captions and brand mark are
 *                                   each a switch, all off by default:
 *                                   the cover draws its own headline.
 *                                   In 9:16 or 4:3 (4:3 to begin with
 *                                   for a showcase made for the 4:3
 *                                   view).
 *                    A scene with no picture of its own is always taken
 *                    whole. Every save is one call to the studio's
 *                    "cover-picture" action, which applies the same rule
 *                    as Claude's save_cover_picture tool
 *                    (server/cover-frame.mjs).
 *   Images           the showcase's images, and "Add an image…" for one
 *                    from this computer.
 *
 * It opens on the video when the showcase has scenes. `onPick` gets the
 * asset key; the caller writes it as the cover's picture. `hint` is a
 * line of advice under the title (which pictures suit a 16:9 thumbnail). */

type Tab = "video" | "images";

const clock = (ms: number) => {
  const tenths = Math.max(0, Math.floor(ms / 100));
  return `${Math.floor(tenths / 600)}:${String(Math.floor((tenths % 600) / 10)).padStart(2, "0")}.${tenths % 10}`;
};

function toBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Re-reads the showcase so a file the studio just wrote into assets/ is
 *  known before the cover points at it. */
async function reread(showcaseId: string) {
  if ((await refreshShowcase(showcaseId)) === "updated") forgetEditBase(showcaseId);
}

export function CoverPicturePicker({
  showcase,
  title,
  hint,
  current,
  onPick,
  onClose,
}: {
  showcase: Showcase;
  title: string;
  hint?: string | undefined;
  /** The picture's asset key now. */
  current?: string | undefined;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(showcase.scenes.length > 0 ? "video" : "images");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = (key: string) => {
    onPick(key);
    onClose();
  };

  return (
    <div
      className="fixed inset-y-0 left-0 z-50 flex items-center justify-center bg-background/70 p-3 backdrop-blur-sm sm:p-6"
      /* Over the page only: it stops at the studio agent's docked panel. */
      style={{ right: "var(--studio-dock, 0px)" }}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
          <p className="min-w-0 flex-1 truncate text-sm text-foreground">{title}</p>
          <div
            role="tablist"
            className="order-last flex w-full rounded-full border border-border p-0.5 text-xs sm:order-none sm:w-auto"
          >
            {(
              [
                { id: "video", label: "From the video", icon: Film },
                { id: "images", label: "Images", icon: Images },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => {
                  setTab(id);
                  setError(null);
                }}
                className={cn(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1 transition-colors sm:flex-none",
                  tab === id
                    ? "bg-primary/15 font-medium text-foreground"
                    : "text-foreground/60 hover:text-foreground",
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the picker"
            title="Close the picker"
            className="rounded-full border border-border p-1.5 text-support transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
          {hint && <p className="order-last w-full text-xs text-muted-foreground">{hint}</p>}
        </div>
        {tab === "video" ? (
          <FromVideo showcase={showcase} onPick={pick} onError={setError} />
        ) : (
          <FromImages showcase={showcase} current={current} onPick={pick} onError={setError} />
        )}
        {error && <p className="border-t border-border px-6 py-3 text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function FromVideo({
  showcase,
  onPick,
  onError,
}: {
  showcase: Showcase;
  onPick: (key: string) => void;
  onError: (message: string | null) => void;
}) {
  const scenes = useMemo(() => {
    let start = 0;
    return showcase.scenes.map((scene) => {
      const entry = { scene, start, end: start + scene.durationMs };
      start = entry.end;
      return entry;
    });
  }, [showcase.scenes]);
  const total = scenes.at(-1)?.end ?? 0;
  /* Start on the first scene with a picture, a little way in. */
  const first = scenes.find(
    ({ scene }) => scene.media.kind === "video" || scene.media.kind === "image",
  );
  const [at, setAt] = useState(
    first ? first.start + Math.min(1000, first.scene.durationMs / 2) : 0,
  );
  const [saving, setSaving] = useState(false);
  /* Picture or whole scene, as last chosen; a scene with no picture of
   * its own is always taken whole. */
  const [wantWhole, setWantWhole] = useState(false);
  const [parts, setParts] = useState<SceneParts>({ title: false, captions: false, mark: false });
  /* A showcase made for the 4:3 view is drawn 4:3 to begin with. */
  const [shape, setShape] = useState<Shape>(showcase.view === "embed" ? "43" : "tiktok");
  const video = useRef<HTMLVideoElement>(null);
  const here = scenes.find(({ start, end }) => at >= start && at < end) ?? scenes.at(-1);
  const media = here?.scene.media;
  const hasPicture = media?.kind === "video" || media?.kind === "image";
  const whole = wantWhole || !hasPicture;

  /* The clip at this moment, by the player's rule (the studio uses the
   * same one to cut the frame). */
  const clipSeconds = (element: HTMLVideoElement) => {
    if (!here || media?.kind !== "video") return 0;
    return clipTimeS({
      elapsedMs: at - here.start,
      sceneMs: here.scene.durationMs,
      clipS: element.duration,
      speed: media.speed ?? 1,
    });
  };
  useEffect(() => {
    const element = video.current;
    if (!element) return undefined;
    const seek = () => {
      element.currentTime = clipSeconds(element);
    };
    if (element.readyState >= 1) seek();
    element.addEventListener("loadedmetadata", seek);
    return () => element.removeEventListener("loadedmetadata", seek);
  });

  /* The studio decides what this moment gives (server/cover-frame.mjs):
   * the clip's frame, the scene's image, or the whole scene. */
  const use = async () => {
    if (!here) return;
    onError(null);
    setSaving(true);
    try {
      const result = await studio()!.assets.savePicture({
        showcaseId: showcase.id,
        atMs: Math.round(at),
        whole,
        view: shape,
        ...shownParts(here.scene, shape, parts),
      });
      if (!result.ok || !result.asset) {
        onError(result.error ?? "The picture could not be saved");
        return;
      }
      if (result.kind !== "image") await reread(showcase.id);
      onPick(result.asset.key);
    } finally {
      setSaving(false);
    }
  };

  if (total === 0) {
    return (
      <p className="px-6 py-10 text-center text-sm text-support">
        This showcase has no scenes yet.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 sm:p-6">
      <div className="flex h-[40vh] items-center justify-center rounded-xl bg-black sm:h-[46vh]">
        {whole && here ? (
          <WholeScene scene={here.scene} shape={shape} elapsedMs={at - here.start} parts={parts} />
        ) : media?.kind === "video" ? (
          <video
            ref={video}
            key={media.src}
            src={media.src}
            muted
            playsInline
            preload="auto"
            className="h-full w-full object-contain"
          />
        ) : media?.kind === "image" ? (
          <img src={media.src} alt={media.alt} className="h-full w-full object-contain" />
        ) : null}
      </div>

      {here && (
        <SceneOptions
          scene={here.scene}
          hasPicture={hasPicture}
          whole={whole}
          onWhole={setWantWhole}
          shape={shape}
          onShape={setShape}
          parts={parts}
          onParts={setParts}
        />
      )}

      <div className="flex flex-col gap-2">
        {/* The scenes along the video, each as wide as it lasts. */}
        <div className="flex h-7 gap-px overflow-hidden rounded-md">
          {scenes.map(({ scene, start, end }) => (
            <button
              key={scene.id}
              type="button"
              title={scene.title || scene.id}
              onClick={() => setAt(start + Math.min(1000, (end - start) / 2))}
              style={{ flexGrow: end - start, flexBasis: 0 }}
              className={cn(
                "min-w-0 truncate px-1.5 text-left text-[0.65rem] transition-colors",
                here?.scene.id === scene.id
                  ? "bg-primary/30 text-foreground"
                  : "bg-secondary text-foreground/70 hover:bg-secondary/70",
              )}
            >
              {scene.title || scene.id}
            </button>
          ))}
        </div>
        <input
          type="range"
          aria-label="Moment in the video"
          min={0}
          max={total - 1}
          step={40}
          value={at}
          onChange={(event) => setAt(Number(event.target.value))}
          className="w-full accent-[var(--primary)]"
        />
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-support">
          <span className="font-mono">
            {clock(at)} / {clock(total)}
          </span>
          <span className="truncate">{here?.scene.title || here?.scene.id}</span>
          <button
            type="button"
            disabled={saving || !here}
            onClick={() => void use()}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {whole
              ? "Use this scene"
              : media?.kind === "image"
                ? "Use this image"
                : "Use this frame"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** What a whole-scene still draws beyond the slide itself. */
type SceneParts = { title: boolean; captions: boolean; mark: boolean };

/** The shape of a whole-scene still: TikTok's 9:16 frame or the 4:3
 *  embed, as the video draws each. */
type Shape = "tiktok" | "43";

/** Why a part can't be switched on this scene, in this shape: it always
 *  shows ("always") or never does ("never"), with the reason the
 *  checkbox's tooltip gives. SceneView and EmbedSceneView decide this;
 *  the picker only says so. */
type Lock = { state: "always" | "never"; reason: string };

function partLocks(scene: Scene, shape: Shape): Partial<Record<keyof SceneParts, Lock>> {
  const textIsPicture = scene.theme === "statement" || scene.media.kind === "none";
  const isText: Lock = { state: "always", reason: "This slide's text is its picture" };
  const locks: Partial<Record<keyof SceneParts, Lock>> = {};
  if (textIsPicture) locks.title = isText;
  else if (scene.theme === "footage") {
    locks.title = { state: "never", reason: "Footage never shows a title" };
  }
  /* The spoken line: on the 9:16 frame it is set as text on a slide that
   * is its text; on the 4:3 embed every layout but console sets it as
   * text beside the picture. */
  if (textIsPicture || (shape === "43" && scene.theme !== "console")) {
    locks.captions = { state: "always", reason: "The spoken line is part of this layout" };
  }
  return locks;
}

/** The parts the still really shows, so its file name says so. */
function shownParts(scene: Scene, shape: Shape, parts: SceneParts): SceneParts {
  const shown = { ...parts };
  for (const [key, lock] of Object.entries(partLocks(scene, shape))) {
    shown[key as keyof SceneParts] = lock.state === "always";
  }
  return shown;
}

/** The scene as the video draws it at `elapsedMs`, in the 9:16 frame or
 *  the 4:3 embed, with its animations at rest: what "Use this scene"
 *  saves. */
function WholeScene({
  scene,
  shape,
  elapsedMs,
  parts,
}: {
  scene: Scene;
  shape: Shape;
  elapsedMs: number;
  parts: SceneParts;
}) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    seekSceneMedia(
      {
        getAnimations: () => element.getAnimations({ subtree: true }),
        querySelectorAll: ((selector: string) =>
          element.querySelectorAll(selector)) as Document["querySelectorAll"],
      },
      scene,
      elapsedMs,
    );
    /* The studio's still finishes animations (server/exporter.mjs), so
     * an entrance shows where it comes to rest. */
    for (const animation of element.getAnimations({ subtree: true })) {
      try {
        animation.finish();
      } catch {
        /* an infinite animation can't finish; it stays where it is */
      }
    }
  });
  return (
    <div
      ref={frame}
      aria-label="The scene as the cover's picture"
      className="pointer-events-none relative h-full max-w-full overflow-hidden"
      style={{ aspectRatio: shape === "43" ? EMBED_ASPECT : TIKTOK_ASPECT }}
    >
      {shape === "43" ? (
        <EmbedSceneView
          key={scene.id}
          scene={scene}
          paused
          elapsedMs={elapsedMs}
          captions={parts.captions}
          hideTitle={!parts.title}
          hideWatermark={!parts.mark}
        />
      ) : (
        <SceneView
          key={scene.id}
          scene={scene}
          paused
          elapsedMs={elapsedMs}
          canvas="tiktok"
          frameless
          hideTitle={!parts.title}
          hideCaption={!parts.captions}
          hideWatermark={!parts.mark}
        />
      )}
    </div>
  );
}

/** A row of mutually exclusive choices, as a pill of buttons. */
function Choice<T extends string | boolean>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string; title: string; disabled?: boolean }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" className="flex rounded-full border border-border p-0.5">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          disabled={option.disabled}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-full px-3 py-1 transition-colors disabled:opacity-40",
            value === option.value
              ? "bg-primary/15 font-medium text-foreground"
              : "text-foreground/60 enabled:hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Picture or whole scene, and the shape and parts of a whole scene. */
function SceneOptions({
  scene,
  hasPicture,
  whole,
  onWhole,
  shape,
  onShape,
  parts,
  onParts,
}: {
  scene: Scene;
  hasPicture: boolean;
  whole: boolean;
  onWhole: (whole: boolean) => void;
  shape: Shape;
  onShape: (shape: Shape) => void;
  parts: SceneParts;
  onParts: (parts: SceneParts) => void;
}) {
  const locks = partLocks(scene, shape);
  const shown = shownParts(scene, shape, parts);
  const toggles: { key: keyof SceneParts; label: string }[] = [
    { key: "title", label: "Title" },
    { key: "captions", label: "Captions" },
    { key: "mark", label: "Brand mark" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
      <Choice
        value={whole}
        onChange={onWhole}
        options={[
          {
            value: false,
            label: "Picture",
            disabled: !hasPicture,
            title: hasPicture
              ? "The scene's own picture, nothing drawn over it"
              : "This scene has no picture of its own — it's text or a graphic",
          },
          { value: true, label: "Whole scene", title: "The slide as the video draws it" },
        ]}
      />
      {whole && (
        <>
          <Choice
            value={shape}
            onChange={onShape}
            options={[
              { value: "tiktok", label: "9:16", title: "The slide as the TikTok video draws it" },
              { value: "43", label: "4:3", title: "The slide as the 4:3 video draws it" },
            ]}
          />
          {toggles.map(({ key, label }) => {
            const lock = locks[key];
            return (
              <label
                key={key}
                title={lock?.reason}
                className={cn(
                  "inline-flex items-center gap-1.5",
                  lock ? "text-foreground/40" : "cursor-pointer text-foreground/80",
                )}
              >
                <input
                  type="checkbox"
                  checked={shown[key]}
                  disabled={lock != null}
                  onChange={(event) => onParts({ ...parts, [key]: event.target.checked })}
                  className="accent-[var(--primary)]"
                />
                {label}
              </label>
            );
          })}
        </>
      )}
    </div>
  );
}

function FromImages({
  showcase,
  current,
  onPick,
  onError,
}: {
  showcase: Showcase;
  current?: string | undefined;
  onPick: (key: string) => void;
  onError: (message: string | null) => void;
}) {
  const images = showcaseAssets(showcase).assets.filter((asset) => asset.kind === "image");
  const input = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);

  const add = async (file: File) => {
    onError(null);
    setAdding(true);
    try {
      const result = await studio()!.assets.add({
        showcaseId: showcase.id,
        files: [{ name: file.name, data: toBase64(await file.arrayBuffer()) }],
      });
      const name = result.names?.[0];
      if (!result.ok || !name) {
        onError(result.error ?? "The image could not be added");
        return;
      }
      await reread(showcase.id);
      onPick(name.slice(0, name.lastIndexOf(".") > 0 ? name.lastIndexOf(".") : name.length));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="grid grid-cols-3 gap-3 overflow-y-auto p-4 sm:grid-cols-4 sm:gap-4 sm:p-6">
      <button
        type="button"
        disabled={adding}
        onClick={() => input.current?.click()}
        className="flex aspect-[9/16] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border text-xs text-foreground/70 transition-colors hover:border-foreground/40 hover:text-foreground"
      >
        {adding ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" />}
        Add an image…
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void add(file);
        }}
      />
      {images.map((asset) => (
        <button
          key={asset.file}
          type="button"
          onClick={() => onPick(asset.key)}
          className={cn(
            "group flex flex-col gap-1.5 rounded-xl border p-2 text-left transition-colors",
            asset.key === current
              ? "border-primary bg-primary/10"
              : "border-border hover:border-foreground/40 hover:bg-secondary/40",
          )}
        >
          <div className="aspect-[9/16] w-full overflow-hidden rounded-lg bg-background">
            <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
          </div>
          <span className="break-all text-[0.65rem] leading-snug text-support group-hover:text-foreground">
            {asset.name}
          </span>
        </button>
      ))}
    </div>
  );
}
