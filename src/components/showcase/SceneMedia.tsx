import { cn } from "@/lib/utils";
import type { MediaAlign, SceneMedia as SceneMediaType, SceneMotion } from "@/content/showcases";

const motionClass: Record<SceneMotion, string> = {
  "zoom-in": "motion-zoom-in",
  "zoom-out": "motion-zoom-out",
  "pan-up": "motion-pan-up",
  "pan-left": "motion-pan-left",
  still: "motion-still",
};

const alignClass: Record<MediaAlign, string> = {
  top: "object-top",
  center: "object-center",
  bottom: "object-bottom",
};

type Props = {
  media: SceneMediaType;
  durationMs: number;
  paused: boolean;
  className?: string;
};

export function SceneMedia({ media, durationMs, paused, className }: Props) {
  if (media.kind === "none") return null;

  const motion = motionClass[media.motion ?? "zoom-in"];
  const fit = media.frame === "mark" || media.fit === "contain" ? "object-contain" : "object-cover";
  const align = alignClass[media.align ?? "center"];
  const fadeAlign = alignClass[media.fadeTo?.align ?? media.align ?? "center"];
  const style = {
    ["--scene-duration" as string]: `${durationMs + 1200}ms`,
    animationPlayState: paused ? ("paused" as const) : ("running" as const),
  };

  return (
    <div
      className={cn(
        "relative h-full w-full",
        media.frame === "mark" ? "overflow-visible" : "overflow-hidden",
        className,
      )}
    >
      {media.kind === "video" ? (
        <video
          key={media.src}
          src={media.src}
          autoPlay
          muted
          loop
          playsInline
          aria-label={media.alt}
          className={cn("h-full w-full", fit, align, motion)}
          style={style}
        />
      ) : (
        <img
          key={media.src}
          src={media.src}
          alt={media.alt}
          className={cn("h-full w-full", fit, align, motion)}
          style={style}
        />
      )}
      {media.kind === "image" && media.fadeTo && (
        <img
          key={media.fadeTo.src}
          src={media.fadeTo.src}
          alt={media.fadeTo.alt}
          className={cn("motion-cross-fade absolute inset-0 h-full w-full", fit, fadeAlign)}
          style={style}
        />
      )}
    </div>
  );
}
