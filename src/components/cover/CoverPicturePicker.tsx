import { useEffect, useMemo, useRef, useState } from "react";
import { Film, ImagePlus, Images, Loader2, X } from "lucide-react";
import { refreshShowcase, showcaseAssets, type Showcase } from "@/content/showcases";
import { forgetEditBase } from "@/lib/edits";
import { studio } from "@/lib/studio";
import { cn } from "@/lib/utils";

/* Choosing the cover's picture, from either place a picture comes from:
 *
 *   From the video   scrub through the whole video; the preview is the
 *                    scene's own picture at that moment (no captions, no
 *                    brand mark). "Use this frame" saves the frame into
 *                    assets/ (server/cover-frame.mjs) and picks it; on a
 *                    scene with an image, the image itself is picked.
 *   Images           the showcase's images, and "Add an image…" for one
 *                    from this computer.
 *
 * It opens on the video when the showcase has one. `onPick` gets the
 * asset key; the caller writes it as the cover's picture. */

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
  current,
  onPick,
  onClose,
}: {
  showcase: Showcase;
  title: string;
  /** The picture's asset key now. */
  current?: string | undefined;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  const hasVideo = showcase.scenes.some((scene) => scene.media.kind === "video");
  const [tab, setTab] = useState<Tab>(hasVideo ? "video" : "images");
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6 backdrop-blur-sm"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="flex max-h-full w-full max-w-3xl flex-col rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-4 border-b border-border px-6 py-4">
          <p className="text-sm text-foreground">{title}</p>
          <div
            role="tablist"
            className="ml-auto flex rounded-full border border-border p-0.5 text-xs"
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
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors",
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
  const video = useRef<HTMLVideoElement>(null);
  const here = scenes.find(({ start, end }) => at >= start && at < end) ?? scenes.at(-1);
  const media = here?.scene.media;

  /* The clip at this moment: the scene's time into it at the clip's
   * speed, looping as the player loops it. */
  const clipSeconds = (element: HTMLVideoElement) => {
    if (!here || media?.kind !== "video") return 0;
    const seconds = ((at - here.start) / 1000) * (media.speed ?? 1);
    return element.duration ? seconds % element.duration : seconds;
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

  const use = async () => {
    if (!here || !media) return;
    onError(null);
    if (media.kind === "image" && media.asset) {
      onPick(media.asset);
      return;
    }
    if (media.kind !== "video" || !video.current) return;
    setSaving(true);
    try {
      const result = await studio()!.assets.saveFrame({
        showcaseId: showcase.id,
        sceneId: here.scene.id,
        clipMs: Math.round(video.current.currentTime * 1000),
      });
      if (!result.ok || !result.asset) {
        onError(result.error ?? "The frame could not be saved");
        return;
      }
      await reread(showcase.id);
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
    <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex h-[46vh] items-center justify-center rounded-xl bg-black">
        {media?.kind === "video" ? (
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
        ) : (
          <p className="max-w-xs text-center text-sm text-white/60">
            This scene has no picture of its own — it's text or a graphic. Move to a scene with
            footage or an image.
          </p>
        )}
      </div>

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
                  : scene.media.kind === "video" || scene.media.kind === "image"
                    ? "bg-secondary text-foreground/70 hover:bg-secondary/70"
                    : "bg-secondary/40 text-foreground/40 hover:bg-secondary/60",
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
        <div className="flex items-center gap-3 text-xs text-support">
          <span className="font-mono">
            {clock(at)} / {clock(total)}
          </span>
          <span className="truncate">{here?.scene.title || here?.scene.id}</span>
          <button
            type="button"
            disabled={saving || !(media?.kind === "video" || media?.kind === "image")}
            onClick={() => void use()}
            className="ml-auto inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity enabled:hover:opacity-90 disabled:opacity-40"
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            {media?.kind === "image" ? "Use this image" : "Use this frame"}
          </button>
        </div>
      </div>
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
    <div className="grid grid-cols-3 gap-4 overflow-y-auto p-6 sm:grid-cols-4">
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
