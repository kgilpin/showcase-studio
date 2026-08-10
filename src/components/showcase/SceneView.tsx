import { cn } from "@/lib/utils";
import { activeCaption, type CaptionPosition, type Scene } from "@/content/showcases";
import { SceneMedia } from "./SceneMedia";
import { PhoneFrame } from "./PhoneFrame";
import appStoreBadge from "@/assets/app-store-badge.svg";

/** CTA content: the App Store badge by default, or a labeled pill button
 *  for `kind: link` (products with no store listing). */
function CtaContent({ cta, badgeClass }: { cta: NonNullable<Scene["cta"]>; badgeClass: string }) {
  if (cta.kind === "link") {
    return (
      <span
        className="inline-flex items-center rounded-full px-7 py-3 text-sm font-medium text-primary-foreground"
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
    return <div className="absolute inset-0 overflow-hidden bg-card">{children}</div>;
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
          className="relative h-full w-full overflow-hidden rounded-[2.2rem] border border-border bg-card"
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
  frameless = false,
}: {
  scene: Scene;
  paused: boolean;
  mode?: DisplayMode;
  /** Time into the current slide — drives sequential captions. */
  elapsedMs?: number;
  /** Captions are rendered outside the stage (side-by-side caption mode). */
  hideCaption?: boolean;
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
              <div className="relative size-28 bg-transparent sm:size-32">{media}</div>
            </div>
          )}
          <h2
            className={cn(
              "font-display leading-[1.05] tracking-tight text-foreground",
              isFixed ? "text-3xl sm:text-4xl" : "text-5xl sm:text-7xl",
            )}
          >
            {scene.title}
          </h2>
          {body && (
            <p
              className={cn(
                "mt-4 text-muted-foreground",
                isFixed ? "text-base" : "text-lg sm:text-xl",
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
              <CtaContent cta={scene.cta} badgeClass={cn("w-auto", isFixed ? "h-10" : "h-12")} />
            </a>
          )}
          {scene.ctaNote && <p className="mt-4 text-xs text-support sm:text-sm">{scene.ctaNote}</p>}
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
    return (
      <FixedStage compact={overlay && hasMedia} frameless={frameless}>
        <div
          className={cn("flex h-full w-full flex-col", !hasMedia && !scene.cta && "justify-center")}
          style={{ background: "var(--gradient-stage)" }}
        >
          <div
            className={cn(
              "scene-rise shrink-0 px-6 text-center",
              hasMedia || scene.cta ? "pt-10" : "pb-6",
            )}
          >
            <h2
              className={cn(
                "font-display leading-[1.08] tracking-tight text-foreground",
                hasMedia ? "text-3xl" : "text-4xl",
              )}
            >
              {scene.title}
            </h2>
            {!overlay && body && (
              <p className={cn("mt-4 text-muted-foreground", captionTextClass)}>{body}</p>
            )}
            {overlay && !hasMedia && body && (
              <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{body}</p>
            )}
            {!hasMedia && scene.support && (
              <p className="mt-6 text-sm leading-relaxed text-support">{scene.support}</p>
            )}
          </div>

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
                      captionTextClass,
                    )}
                  >
                    {body}
                  </p>
                </div>
              )}
            </div>
          )}

          {hasMedia && !isConsole && (
            <div className="scene-drift relative mt-7 min-h-0 flex-1 overflow-hidden rounded-t-[1.6rem] border-x border-t border-border">
              {media}
              {overlay && body && !hideCaption && (
                <div
                  key={captionKey}
                  className={cn("caption-fade absolute inset-x-3", captionPlacement)}
                >
                  <p
                    className={cn(
                      "rounded-2xl border border-border bg-background/80 px-4 py-3 text-center text-muted-foreground backdrop-blur-md",
                      captionTextClass,
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
                <CtaContent cta={scene.cta} badgeClass="mx-auto h-11 w-auto" />
              </a>
              {scene.ctaNote && <p className="mt-4 text-xs text-support">{scene.ctaNote}</p>}
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
