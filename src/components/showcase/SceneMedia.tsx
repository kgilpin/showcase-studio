import { useEffect, useRef } from "react";
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
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrc = media.kind === "video" ? media.src : undefined;

  /* The `paused` prop freezes CSS animations via animationPlayState, but a
   * <video> runs on its own clock — pause and resume it explicitly. */
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (paused) video.pause();
    else void video.play().catch(() => undefined);
  }, [paused, videoSrc]);

  if (media.kind === "none") return null;

  /* TSX-authored diagram: the component fills the media area and animates
   * itself with CSS. `media-paused` (styles.css) freezes those animations
   * when the player is paused. */
  if (media.kind === "graphic") {
    const Graphic = media.component;
    const graphicMotion = motionClass[media.motion ?? "still"];
    return (
      <div
        role="img"
        aria-label={media.alt}
        className={cn(
          "relative h-full w-full overflow-hidden",
          paused && "media-paused",
          className,
        )}
      >
        <div
          className={cn("h-full w-full", graphicMotion)}
          style={{ ["--scene-duration" as string]: `${durationMs + 1200}ms` }}
        >
          <Graphic />
        </div>
      </div>
    );
  }

  /* Images get a slow zoom by default to keep stills alive; footage already
   * moves, so video plays plain unless a motion is asked for. */
  const motion = motionClass[media.motion ?? (media.kind === "video" ? "still" : "zoom-in")];
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
          ref={videoRef}
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
