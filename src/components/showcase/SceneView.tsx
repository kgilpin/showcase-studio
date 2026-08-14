import { cn } from "@/lib/utils";
import { activeCaption, type CaptionPosition, type Scene } from "@/content/showcases";
import { SceneMedia } from "./SceneMedia";
import { PhoneFrame } from "./PhoneFrame";
import appStoreBadge from "@/assets/app-store-badge.svg";

/** CTA content: the App Store badge by default, or a labeled pill button
 *  for `kind: link` (products with no store listing). */
function CtaContent({
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

/** How the showcase lays out each scene. Toggled from the player controls. */
export type DisplayMode = "side-by-side" | "fixed-separated" | "fixed-overlay";

/** iPhone 16 Pro Max screen aspect ratio (1320 x 2868). */
export const FIXED_ASPECT = "1320 / 2868";

/** Vertical placement of the overlay caption on a slide. */
const captionPositionClass: Record<CaptionPosition, string> = {
  top: "top-5",
  center: "top-1/2 -translate-y-1/2",
  lower: "top-[60%] -translate-y-1/2",
  bottom: "bottom-5",
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

export function SceneView({
  scene,
  paused,
  mode = "side-by-side",
  elapsedMs = 0,
  hideCaption = false,
  hideTitle = false,
  frameless = false,
}: {
  scene: Scene;
  paused: boolean;
  mode?: DisplayMode;
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
  const isFixed = mode !== "side-by-side";
  const caption = activeCaption(scene, elapsedMs);
  const body = caption?.text ?? scene.body;
  const captionKey = caption?.text ?? "body";
  const captionPlacement = captionPositionClass[caption?.position ?? "bottom"];
  const captionTextClass = "text-base leading-relaxed sm:text-lg";
  /* Inside the fixed stage, type is sized in container-width units so the
   * text keeps the same proportion at any render size — the in-page player,
   * the screenshot export, and the video recorder all get the same look. */
  const stageCaptionClass = "text-[5.2cqw] leading-relaxed";

  /* THEME: title — app mark above a large display-serif title. */
  if (scene.theme === "title") {
    const titleContent = (
      <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
        <div className="scene-rise flex max-w-3xl flex-col items-center">
          {scene.media.kind !== "none" && (
            <div className="relative mb-10">
              <div
                aria-hidden
                className="scene-glow absolute -inset-8 rounded-full bg-[var(--gradient-accent)] opacity-40 blur-[60px]"
              />
              <div
                className={cn(
                  "relative bg-transparent",
                  isFixed ? "size-[36cqw]" : "size-28 sm:size-32",
                )}
              >
                {media}
              </div>
            </div>
          )}
          <h2
            className={cn(
              "font-display leading-[1.05] tracking-tight text-foreground",
              isFixed ? "text-[10.5cqw]" : "text-5xl sm:text-7xl",
            )}
          >
            {scene.title}
          </h2>
          {body && (
            <p
              className={cn(
                "mt-4 text-muted-foreground",
                isFixed ? "text-[5cqw]" : "text-lg sm:text-xl",
              )}
            >
              {body}
            </p>
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
                badgeClass={cn("w-auto", isFixed ? "h-[11cqw]" : "h-12")}
                pillClass={isFixed ? "px-[6cqw] py-[2.6cqw] text-[4.2cqw]" : undefined}
              />
            </a>
          )}
          {scene.ctaNote && (
            <p
              className={cn("mt-4 text-support", isFixed ? "text-[3.5cqw]" : "text-xs sm:text-sm")}
            >
              {scene.ctaNote}
            </p>
          )}
        </div>
      </div>
    );
    if (isFixed) {
      return (
        <FixedStage frameless={frameless}>
          <div className="relative h-full w-full" style={{ background: "var(--gradient-stage)" }}>
            {titleContent}
          </div>
        </FixedStage>
      );
    }
    return (
      <div className="absolute inset-0" style={{ background: "var(--gradient-stage)" }}>
        {titleContent}
      </div>
    );
  }

  /* Fixed-aspect modes: everything stacks inside an iPhone-shaped stage.
   * Console scenes show their landscape media as a centered widescreen
   * band instead of cropping it to the portrait stage. */
  if (isFixed) {
    const overlay = mode === "fixed-overlay";
    const hasMedia = scene.media.kind !== "none";
    const isConsole = scene.theme === "console";
    const dropHeader = hideTitle && hasMedia;
    return (
      <FixedStage compact={overlay && hasMedia} frameless={frameless}>
        <div
          className={cn("flex h-full w-full flex-col", !hasMedia && !scene.cta && "justify-center")}
          style={{ background: "var(--gradient-stage)" }}
        >
          {!dropHeader && (
            <div
              className={cn(
                "scene-rise shrink-0 px-6 text-center",
                hasMedia || scene.cta ? "pt-10" : "pb-6",
              )}
            >
              <h2
                className={cn(
                  "font-display leading-[1.08] tracking-tight text-foreground",
                  hasMedia ? "text-[9cqw]" : "text-[10.5cqw]",
                )}
              >
                {scene.title}
              </h2>
              {!overlay && body && (
                <p className={cn("mt-4 text-muted-foreground", stageCaptionClass)}>{body}</p>
              )}
              {overlay && !hasMedia && body && (
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
                  "scene-drift relative w-full overflow-hidden border-y border-border bg-card",
                  scene.media.kind === "graphic" && "min-h-0 flex-1",
                )}
                style={scene.media.kind === "graphic" ? undefined : { aspectRatio: "16 / 10" }}
              >
                {media}
              </div>
              {overlay && body && !hideCaption && (
                <div key={captionKey} className="caption-fade absolute inset-x-3 bottom-5">
                  <p
                    className={cn(
                      "rounded-2xl border border-border bg-background/80 px-4 py-3 text-center text-muted-foreground backdrop-blur-md",
                      stageCaptionClass,
                    )}
                  >
                    {body}
                  </p>
                </div>
              )}
            </div>
          )}

          {hasMedia && !isConsole && (
            <div
              className={cn(
                "scene-drift relative min-h-0 flex-1 overflow-hidden",
                !dropHeader && "mt-7 rounded-t-[1.6rem] border-x border-t border-border",
              )}
            >
              {media}
              {overlay && body && !hideCaption && (
                <div
                  key={captionKey}
                  className={cn("caption-fade absolute inset-x-3", captionPlacement)}
                >
                  <p
                    className={cn(
                      "rounded-2xl border border-border bg-background/80 px-4 py-3 text-center text-muted-foreground backdrop-blur-md",
                      stageCaptionClass,
                    )}
                  >
                    {body}
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

  /* THEME: console — title above a wide landscape media panel; captions
   * overlay the panel like the fixed-overlay mode. */
  if (scene.theme === "console" && scene.media.kind !== "none") {
    return (
      <div key={scene.id} className="absolute inset-0">
        <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col items-center justify-center gap-7 px-6 py-10 sm:px-10">
          <div className="scene-rise max-w-3xl shrink-0 text-center">
            <h2 className="font-display text-3xl leading-[1.08] tracking-tight text-foreground sm:text-5xl">
              {scene.title}
            </h2>
          </div>
          <div className="relative flex min-h-0 w-full flex-1 justify-center">
            <div
              className="scene-drift relative h-full max-w-full overflow-hidden rounded-3xl border border-border bg-card"
              style={{
                ...(scene.media.kind === "graphic" ? {} : { aspectRatio: "16 / 10" }),
                boxShadow: "var(--shadow-device)",
              }}
            >
              {media}
              {body && !hideCaption && (
                <div
                  key={captionKey}
                  className={cn("caption-fade absolute inset-x-4", captionPlacement)}
                >
                  <p
                    className={cn(
                      "mx-auto max-w-2xl rounded-2xl border border-border bg-background/80 px-4 py-3 text-center text-muted-foreground backdrop-blur-md",
                      captionTextClass,
                    )}
                  >
                    {body}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isCentered = scene.theme === "statement";
  const showMark = isCentered && scene.media.kind !== "none" && scene.media.frame === "mark";
  const showBackdrop = isCentered && scene.media.kind !== "none" && scene.media.frame !== "mark";

  return (
    <div key={scene.id} className="absolute inset-0">
      {showBackdrop && (
        <div className="absolute inset-0 opacity-70">
          {media}
          <div className="absolute inset-0 bg-background/55 backdrop-blur-[2px]" />
        </div>
      )}

      <div
        className={cn(
          "relative mx-auto flex h-full w-full max-w-6xl px-6 sm:px-10",
          isCentered
            ? "items-center justify-center text-center"
            : "flex-col items-center justify-center gap-8 py-12 md:flex-row md:gap-16 md:text-left",
          !isCentered && scene.flip && "md:flex-row-reverse",
        )}
      >
        <div
          className={cn(
            "scene-rise",
            isCentered ? "max-w-2xl" : "max-w-md text-center md:text-left",
          )}
        >
          {showMark && (
            <div className="relative mx-auto mb-12 w-fit">
              <div
                aria-hidden
                className="scene-glow absolute -inset-6 rounded-full bg-[var(--gradient-accent)] opacity-40 blur-[48px]"
              />
              <div className="relative mx-auto size-20 bg-transparent sm:size-24">{media}</div>
            </div>
          )}
          <h2
            className={cn(
              "font-display leading-[1.05] tracking-tight text-foreground",
              isCentered ? "text-5xl sm:text-7xl" : "text-4xl sm:text-5xl",
            )}
          >
            {scene.title}
          </h2>
          {body && (
            <p
              className={cn(
                isCentered
                  ? "mx-auto mt-10 font-display text-2xl leading-snug text-muted-foreground sm:text-3xl"
                  : "mt-5 text-base leading-relaxed text-muted-foreground sm:text-lg",
              )}
            >
              {body}
            </p>
          )}
          {isCentered && scene.support && (
            <p className="mx-auto mt-7 max-w-lg text-sm leading-relaxed text-support sm:text-base">
              {scene.support}
            </p>
          )}
          {isCentered && scene.cta && (
            <a
              href={scene.cta.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-12 inline-block"
            >
              <CtaContent cta={scene.cta} badgeClass="h-12 w-auto" />
            </a>
          )}
          {isCentered && scene.ctaNote && (
            <p className="mt-7 text-xs text-support sm:text-sm">{scene.ctaNote}</p>
          )}
        </div>

        {!isCentered && scene.media.kind !== "none" && (
          <PhoneFrame className="scene-drift w-[15rem] shrink-0 sm:w-[17rem]">{media}</PhoneFrame>
        )}
      </div>
    </div>
  );
}
