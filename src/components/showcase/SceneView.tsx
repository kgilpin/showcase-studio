import { cn } from "@/lib/utils";
import { activeCaption, type CaptionPosition, type Scene } from "@/content/showcases";
import { SceneMedia } from "./SceneMedia";
import appStoreBadge from "@/assets/app-store-badge.svg";

/** CTA content: the App Store badge by default, or a labeled pill button
 *  for `kind: link` (products with no store listing). Shared with the
 *  4:3 embed canvas (EmbedSceneView). */
export function CtaContent({
  cta,
  badgeClass,
  pillClass = "px-7 py-3 text-sm",
}: {
  cta: NonNullable<Scene["cta"]>;
  badgeClass: string;
  pillClass?: string | undefined;
}) {
  if (cta.kind === "link") {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full font-medium text-primary-foreground",
          pillClass,
        )}
        style={{ background: "var(--gradient-accent)" }}
      >
        {cta.label}
      </span>
    );
  }
  return <img src={appStoreBadge} alt={cta.label} className={badgeClass} />;
}

/** iPhone 16 Pro Max screen aspect ratio (1320 x 2868). */
export const FIXED_ASPECT = "1320 / 2868";

/** Vertical placement of the overlay caption on a slide. The default
 *  "bottom" floats 18% up from the edge — clear of TikTok's caption
 *  block, music bar, and seekbar, which own the bottom fifth of the
 *  frame in the overlay (video) presentation. */
const captionPositionClass: Record<CaptionPosition, string> = {
  top: "top-5",
  center: "top-1/2 -translate-y-1/2",
  lower: "top-[60%] -translate-y-1/2",
  bottom: "bottom-[18%]",
};

function FixedStage({
  children,
  compact,
  frameless,
}: {
  children: React.ReactNode;
  compact?: boolean;
  /** Fill the parent edge-to-edge with no device chrome (screenshot export). */
  frameless?: boolean;
}) {
  if (frameless) {
    return <div className="@container absolute inset-0 overflow-hidden bg-card">{children}</div>;
  }
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center",
        compact ? "justify-center p-0" : "justify-center px-3 py-4",
      )}
    >
      <div className="relative h-full max-w-full" style={{ aspectRatio: FIXED_ASPECT }}>
        <div
          aria-hidden
          className="absolute -inset-8 rounded-[999px] bg-[var(--gradient-accent)] opacity-40 blur-[70px]"
        />
        <div
          className="@container relative h-full w-full overflow-hidden rounded-[2.2rem] border border-border bg-card"
          style={{ boxShadow: "var(--shadow-device)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/** Renders one scene inside the iPhone-shaped stage. Type is sized in
 *  container-width units so the text keeps the same proportion at any
 *  render size — the in-page player, the screenshot export, and the video
 *  recorder all get the same look. */
export function SceneView({
  scene,
  paused,
  elapsedMs = 0,
  hideCaption = false,
  hideTitle = false,
  frameless = false,
}: {
  scene: Scene;
  paused: boolean;
  /** Time into the current slide — drives sequential captions. */
  elapsedMs?: number;
  /** Captions are rendered outside the stage (App Screens presentation). */
  hideCaption?: boolean;
  /** Video presentation: drop the slide title so overlaid captions don't
   *  compete with it. Only applies to scenes with media — on media-less
   *  scenes the title is the visual and always stays. */
  hideTitle?: boolean;
  /** Drop the device chrome and fill the parent (screenshot export). */
  frameless?: boolean;
}) {
  const media = <SceneMedia media={scene.media} durationMs={scene.durationMs} paused={paused} />;
  /* Entrance animation is opt-in (`transition: rise`) — by default scenes
   * cut cleanly, which footage-to-footage sequences need. */
  const rise = scene.transition === "rise" ? "scene-rise" : undefined;
  const drift = scene.transition === "rise" ? "scene-drift" : undefined;
  const caption = activeCaption(scene, elapsedMs);
  /* A caption that duplicates the displayed title stays off the slide —
   * the title already says it (narration and display often share a line
   * on statement slides). */
  const spoken = caption?.text ?? scene.body;
  const body = spoken === scene.title ? undefined : spoken;
  const captionKey = caption?.text ?? "body";
  const captionPlacement = captionPositionClass[caption?.position ?? "bottom"];
  /* Bold white text in per-line chips — captioning, not interface. The
   * generous line-height spaces the cloned chips apart. */
  const stageCaptionClass = "text-[5.2cqw] font-semibold leading-[1.55] text-white";

  /* THEME: statement — centered display text; optional app-mark media
   * above the title, or full-bleed media as a dimmed backdrop behind it. */
  if (scene.theme === "statement") {
    const backdrop = scene.media.kind !== "none" && scene.media.frame === "full";
    return (
      <FixedStage frameless={frameless}>
        <div className="relative h-full w-full" style={{ background: "var(--gradient-stage)" }}>
          {backdrop && (
            <>
              <div className="absolute inset-0">{media}</div>
              <div aria-hidden className="absolute inset-0 bg-background/70" />
            </>
          )}
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
            <div className={cn("flex max-w-3xl flex-col items-center", rise)}>
              {!backdrop && scene.media.kind !== "none" && (
                <div className="relative mb-10">
                  <div
                    aria-hidden
                    className="scene-glow absolute -inset-8 rounded-full bg-[var(--gradient-accent)] opacity-40 blur-[60px]"
                  />
                  <div className="relative size-[36cqw] bg-transparent">{media}</div>
                </div>
              )}
              {scene.title && (
                <h2 className="font-display text-[10.5cqw] leading-[1.05] tracking-tight text-foreground">
                  {scene.title}
                </h2>
              )}
              {body && <p className="mt-4 text-[5cqw] text-muted-foreground">{body}</p>}
              {scene.support && (
                <p className="mt-6 text-[4.2cqw] leading-relaxed text-support">{scene.support}</p>
              )}
              {scene.cta && (
                <a
                  href={scene.cta.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-9 inline-block transition-opacity hover:opacity-80"
                >
                  <CtaContent
                    cta={scene.cta}
                    badgeClass="h-[11cqw] w-auto"
                    pillClass="px-[6cqw] py-[2.6cqw] text-[4.2cqw]"
                  />
                </a>
              )}
              {scene.ctaNote && <p className="mt-4 text-[3.5cqw] text-support">{scene.ctaNote}</p>}
            </div>
          </div>
        </div>
      </FixedStage>
    );
  }

  /* Other themes stack inside the stage: title header, media, CTA.
   * Console scenes show their landscape media as a centered widescreen
   * band instead of cropping it to the portrait stage; footage fills the
   * stage edge-to-edge with no header — the media IS the slide. */
  const hasMedia = scene.media.kind !== "none";
  const isConsole = scene.theme === "console";
  const fullBleed =
    scene.media.kind !== "none" && (scene.theme === "footage" || scene.media.frame === "full");
  const dropHeader = hasMedia && (hideTitle || fullBleed || !scene.title);
  return (
    <FixedStage compact={hasMedia} frameless={frameless}>
      <div
        className={cn("flex h-full w-full flex-col", !hasMedia && !scene.cta && "justify-center")}
        style={{ background: "var(--gradient-stage)" }}
      >
        {!dropHeader && (
          <div
            className={cn(
              "shrink-0 px-6 text-center",
              rise,
              hasMedia || scene.cta ? "pt-10" : "pb-6",
            )}
          >
            {scene.title && (
              <h2
                className={cn(
                  "font-display leading-[1.08] tracking-tight text-foreground",
                  hasMedia ? "text-[9cqw]" : "text-[10.5cqw]",
                )}
              >
                {scene.title}
              </h2>
            )}
            {!hasMedia && body && (
              <p className="mt-5 text-[5.4cqw] leading-relaxed text-muted-foreground">{body}</p>
            )}
            {!hasMedia && scene.support && (
              <p className="mt-6 text-[4.2cqw] leading-relaxed text-support">{scene.support}</p>
            )}
          </div>
        )}

        {hasMedia && isConsole && (
          <div className="relative mt-4 flex min-h-0 w-full flex-1 flex-col justify-center">
            {/* Screenshots keep the 16:10 landscape band; TSX graphics are
             * drawn portrait-first and fill the whole remaining height. */}
            <div
              className={cn(
                "relative w-full overflow-hidden border-y border-border bg-card",
                drift,
                scene.media.kind === "graphic" && "min-h-0 flex-1",
              )}
              style={scene.media.kind === "graphic" ? undefined : { aspectRatio: "16 / 10" }}
            >
              {media}
            </div>
            {body && !hideCaption && (
              <div
                key={captionKey}
                className="caption-fade absolute inset-x-6 bottom-5 text-center"
              >
                <p className={stageCaptionClass}>
                  <span className="caption-chip">{body}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {hasMedia && !isConsole && (
          <div
            className={cn(
              "relative min-h-0 flex-1 overflow-hidden",
              drift,
              !dropHeader && "mt-7 rounded-t-[1.6rem] border-x border-t border-border",
            )}
          >
            {media}
            {body && !hideCaption && (
              <div
                key={captionKey}
                className={cn("caption-fade absolute inset-x-6 text-center", captionPlacement)}
              >
                <p className={stageCaptionClass}>
                  <span className="caption-chip">{body}</span>
                </p>
              </div>
            )}
          </div>
        )}

        {scene.cta && (
          <div className="shrink-0 px-6 py-7 text-center">
            <a
              href={scene.cta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block"
            >
              <CtaContent
                cta={scene.cta}
                badgeClass="mx-auto h-[11cqw] w-auto"
                pillClass="px-[6cqw] py-[2.6cqw] text-[4.2cqw]"
              />
            </a>
            {scene.ctaNote && <p className="mt-4 text-[3.5cqw] text-support">{scene.ctaNote}</p>}
          </div>
        )}
      </div>
    </FixedStage>
  );
}
