import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { MediaAlign, SceneMedia as SceneMediaType, SceneMotion } from "@/content/showcases";
import { focusPercent, resolveTikTokFit } from "@/content/tiktok-fit";
import { pictureRect } from "@/content/media-overlay";

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

/* The same alignments as a vertical object-position, for placing an overlay. */
const alignPercent: Record<MediaAlign, number> = { top: 0, center: 50, bottom: 100 };

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
  /* A video must never run while the player is paused — autoplay can
   * start one after the effect above has paused it. */
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const holdIfPaused = (e: { currentTarget: HTMLVideoElement }) => {
    if (pausedRef.current) e.currentTarget.pause();
  };

  /* An overlay needs two sizes to find the picture: the media box's, and
   * the picture's own (known once the image or the video's metadata has
   * loaded). The picture size is kept with its src, so a new asset never
   * borrows the last one's. */
  const boxRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number }>();
  const [picture, setPicture] = useState<{ src: string; width: number; height: number }>();
  const pictureSrc = media.kind === "image" || media.kind === "video" ? media.src : undefined;
  const hasOverlay = (media.kind === "image" || media.kind === "video") && !!media.overlay;
  /* A TikTok area puts the box in an element of its own: measure again
   * when it comes or goes. */
  const areaKey =
    canvas === "tiktok" && (media.kind === "image" || media.kind === "video")
      ? JSON.stringify(media.tiktok?.area ?? null)
      : "";
  useEffect(() => {
    const el = boxRef.current;
    if (!hasOverlay || !el) return;
    const measure = () => setBox({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasOverlay, areaKey]);
  useEffect(() => {
    /* An image or video that loaded before this effect ran fires no event. */
    if (!hasOverlay || !pictureSrc) return;
    const video = videoRef.current;
    const img = imgRef.current;
    if (video && video.readyState >= 1) {
      setPicture({ src: pictureSrc, width: video.videoWidth, height: video.videoHeight });
    } else if (img?.complete && img.naturalWidth) {
      setPicture({ src: pictureSrc, width: img.naturalWidth, height: img.naturalHeight });
    }
  }, [hasOverlay, pictureSrc]);

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
  const area = tiktok?.area;
  /* The band fill: the same picture, covering the frame, blurred and
   * dimmed so the sharp copy in front reads as the subject. */
  const bandClass =
    "absolute inset-0 h-full w-full scale-110 object-cover blur-[6cqw] brightness-50";
  /* The overlay's box: exactly where the picture landed, by the same fit
   * and position the picture itself used. */
  const Overlay = media.overlay?.component;
  const overlayRect =
    Overlay && box && picture?.src === media.src
      ? pictureRect(box, picture, fit === "object-contain" ? "contain" : "cover", {
          x: 50,
          y:
            tiktok?.fit === "fill"
              ? focusPercent(tiktok.focus)
              : alignPercent[media.align ?? "center"],
        })
      : undefined;
  const onPictureSize = (width: number, height: number) => {
    if (Overlay && width && height) setPicture({ src: media.src, width, height });
  };

  /* The picture and everything drawn on it. With a TikTok area they go in
   * that box; the blurred bands still fill the whole frame. */
  const layers = (
    <>
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
          onPlay={holdIfPaused}
          onLoadedMetadata={(e) =>
            onPictureSize(e.currentTarget.videoWidth, e.currentTarget.videoHeight)
          }
        />
      ) : (
        <img
          key={media.src}
          ref={imgRef}
          src={media.src}
          alt={media.alt}
          className={cn("relative h-full w-full", fit, align, motion)}
          style={{ ...style, ...focusStyle }}
          onLoad={(e) => onPictureSize(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
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
      {/* The overlay mounts with the picture, so its CSS animations start
            when the clip does (the video recorder scrubs both on the same
            clock). It shares the picture's motion, so a zoom moves both
            together, and stays hidden until the picture's size is known. */}
      {Overlay && (
        <div
          aria-hidden
          className={cn("pointer-events-none absolute inset-0", motion, paused && "media-paused")}
          style={style}
        >
          <div
            className="absolute"
            style={
              overlayRect
                ? {
                    left: overlayRect.left,
                    top: overlayRect.top,
                    width: overlayRect.width,
                    height: overlayRect.height,
                  }
                : { inset: 0, visibility: "hidden" }
            }
          >
            <Overlay />
          </div>
        </div>
      )}
    </>
  );

  return (
    <div
      ref={area ? undefined : boxRef}
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
          onPlay={holdIfPaused}
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
      {area ? (
        <div
          ref={boxRef}
          className="absolute overflow-hidden"
          style={{
            top: `${area.top}%`,
            right: `${area.right}%`,
            bottom: `${area.bottom}%`,
            left: `${area.left}%`,
          }}
        >
          {layers}
        </div>
      ) : (
        layers
      )}
    </div>
  );
}
