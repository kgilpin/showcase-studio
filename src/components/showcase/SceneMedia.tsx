import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { MediaAlign, SceneMedia as SceneMediaType, SceneMotion } from "@/content/showcases";
import { focusPercent, resolveTikTokFit } from "@/content/tiktok-fit";

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
  /** "tiktok" places the picture in the 9:16 frame by its TikTok fit
   *  (media.tiktok — fill with a focus, or fit with bands); "portrait"
   *  uses the everyday fit and align. */
  canvas?: "portrait" | "tiktok";
};

export function SceneMedia({ media, durationMs, paused, className, canvas = "portrait" }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const bandVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoSrc = media.kind === "video" ? media.src : undefined;

  /* The `paused` prop freezes CSS animations via animationPlayState, but a
   * <video> runs on its own clock — pause and resume it explicitly (the
   * blurred band copy too, so it stays in step). */
  useEffect(() => {
    for (const video of [videoRef.current, bandVideoRef.current]) {
      if (!video) continue;
      if (paused) video.pause();
      else void video.play().catch(() => undefined);
    }
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
  const style = {
    ["--scene-duration" as string]: `${durationMs + 1200}ms`,
    animationPlayState: paused ? ("paused" as const) : ("running" as const),
  };
  /* The TikTok frame: fill crops to the focus (as object-position, so 0%
   * keeps the top and 100% the bottom); fit shows the whole picture and
   * may lay a blurred copy behind it. The app mark always stays whole. */
  const tiktok =
    canvas === "tiktok" && media.frame !== "mark"
      ? (media.tiktok ?? resolveTikTokFit(undefined, undefined, media))
      : undefined;
  const fit = tiktok
    ? tiktok.fit === "fit"
      ? "object-contain"
      : "object-cover"
    : media.frame === "mark" || media.fit === "contain"
      ? "object-contain"
      : "object-cover";
  const focusStyle =
    tiktok?.fit === "fill" ? { objectPosition: `50% ${focusPercent(tiktok.focus)}%` } : undefined;
  const align = focusStyle ? undefined : alignClass[media.align ?? "center"];
  const fadeAlign = focusStyle
    ? undefined
    : alignClass[media.fadeTo?.align ?? media.align ?? "center"];
  const blurBands = tiktok?.fit === "fit" && tiktok.bands === "blur";
  /* The band fill: the same picture, covering the frame, blurred and
   * dimmed so the sharp copy in front reads as the subject. */
  const bandClass =
    "absolute inset-0 h-full w-full scale-110 object-cover blur-[6cqw] brightness-50";

  return (
    <div
      className={cn(
        "relative h-full w-full",
        media.frame === "mark" ? "overflow-visible" : "overflow-hidden",
        className,
      )}
    >
      {blurBands && media.kind === "video" && (
        <video
          key={`band-${media.src}`}
          ref={bandVideoRef}
          src={media.src}
          autoPlay
          muted
          loop
          playsInline
          aria-hidden
          className={bandClass}
        />
      )}
      {blurBands && media.kind === "image" && (
        <img key={`band-${media.src}`} src={media.src} alt="" aria-hidden className={bandClass} />
      )}
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
          className={cn("relative h-full w-full", fit, align, motion)}
          style={{ ...style, ...focusStyle }}
        />
      ) : (
        <img
          key={media.src}
          src={media.src}
          alt={media.alt}
          className={cn("relative h-full w-full", fit, align, motion)}
          style={{ ...style, ...focusStyle }}
        />
      )}
      {media.kind === "image" && media.fadeTo && (
        <img
          key={media.fadeTo.src}
          src={media.fadeTo.src}
          alt={media.fadeTo.alt}
          className={cn("motion-cross-fade absolute inset-0 h-full w-full", fit, fadeAlign)}
          style={{ ...style, ...focusStyle }}
        />
      )}
    </div>
  );
}
