import { cn } from "@/lib/utils";
import { activeCaption, wordTimeline, type Scene, type WordWindow } from "@/content/showcases";
import { SceneMedia } from "./SceneMedia";
import { captionStartStyle } from "@/content/caption-starts-rules.mjs";
import { captionPlacement } from "./caption-placement";
import type { CaptionPreset } from "@/content/caption-position-rules.mjs";
import { SceneWatermark } from "./SceneWatermark";
import { TikTokSafeArea } from "./TikTokSafeArea";
import { usesTikTokFit } from "@/content/tiktok-fit";
import { EditableText } from "@/components/studio/EditableText";
import appStoreBadge from "@/assets/app-store-badge.svg";
import githubBadge from "@/assets/github-badge.svg";

/** CTA content: the App Store badge by default, the "View on GitHub"
 *  badge for `kind: github`, or a labeled pill button for `kind: link`
 *  (any other destination). Shared with the 4:3 embed canvas
 *  (EmbedSceneView). */
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
  if (cta.kind === "github") {
    return <img src={githubBadge} alt={cta.label} className={badgeClass} />;
  }
  return <img src={appStoreBadge} alt={cta.label} className={badgeClass} />;
}

/** iPhone 16 Pro Max screen aspect ratio (1320 x 2868): the App Screens
 *  canvas, the App Store screenshot size. */
export const FIXED_ASPECT = "1320 / 2868";

/** TikTok's frame, 9:16 (1080 x 1920): the TikTok view and video. */
export const TIKTOK_ASPECT = "1080 / 1920";

/** The two portrait canvases SceneView draws. */
export type PortraitCanvas = "portrait" | "tiktok";

/** Word-by-word caption painting. The full line is laid out once in its
 *  chip so nothing reflows; each word changes state on its wordTimeline
 *  window (or exact voiceover word timestamps when the caption carries
 *  them). "karaoke" dims unspoken words; "reveal" hides them. The word
 *  being spoken takes `--caption-word` (defaults to the caption text
 *  color). Time-driven (not animated), so the live player, TikTok view,
 *  and the frame-by-frame video export all land on identical frames. */
export function WordLine({
  entry,
  elapsedMs,
  mode,
}: {
  entry: { text: string; startMs: number; durationMs: number; words?: WordWindow[] };
  elapsedMs: number;
  mode: "karaoke" | "reveal";
}) {
  const words = entry.words ?? wordTimeline(entry);
  return (
    <>
      {words.map((word, i) => {
        const state =
          elapsedMs >= word.startMs ? (elapsedMs < word.endMs ? "current" : "spoken") : "unspoken";
        return (
          <span
            key={i}
            className={
              state === "unspoken" ? (mode === "reveal" ? "invisible" : "opacity-30") : undefined
            }
            style={state === "current" ? { color: "var(--caption-word, currentColor)" } : undefined}
          >
            {word.word}
            {i < words.length - 1 ? " " : ""}
          </span>
        );
      })}
    </>
  );
}

/** Vertical placement of the overlay caption on a portrait slide —
 *  the TikTok video, a 9:16 frame. In the TikTok app the frame fills the
 *  screen above the tab bar, and TikTok covers about its top 13% (status
 *  bar, For You / Following tabs, search) and bottom 25% (username,
 *  description, sound), so "top" sits just below the tabs, where
 *  TikTok's own captions go, and "bottom" (the default) sits just above
 *  the description. TikTokSafeArea draws those areas in the player. An
 *  exact height ("14%") is placed by captionPlacement. */
const captionPositionClass: Record<CaptionPreset, string> = {
  top: "top-[13%]",
  center: "top-1/2 -translate-y-1/2",
  lower: "top-[60%] -translate-y-1/2",
  bottom: "bottom-[25%]",
};

function FixedStage({
  children,
  compact,
  frameless,
  watermark,
  canvas = "portrait",
  safeArea = false,
}: {
  children: React.ReactNode;
  canvas?: PortraitCanvas;
  /** Shade where TikTok's interface will sit (TikTok canvas only). */
  safeArea?: boolean;
  compact?: boolean;
  /** Fill the parent edge-to-edge with no device chrome (screenshot export). */
  frameless?: boolean;
  /** The scene's brand mark, drawn in a corner over everything else.
   *  It lives here so every theme gets it without repeating itself. */
  watermark?: Scene["watermark"];
}) {
  const bug = (
    <>
      <SceneWatermark watermark={watermark} canvas={canvas} />
      {safeArea && canvas === "tiktok" && <TikTokSafeArea />}
    </>
  );
  if (frameless) {
    return (
      <div className="@container absolute inset-0 overflow-hidden bg-card">
        {children}
        {bug}
      </div>
    );
  }
  return (
    <div
      className={cn(
        "absolute inset-0 flex items-center",
        compact ? "justify-center p-0" : "justify-center px-3 py-4",
      )}
    >
      <div
        className="relative h-full max-w-full"
        style={{ aspectRatio: canvas === "tiktok" ? TIKTOK_ASPECT : FIXED_ASPECT }}
      >
        <div
          aria-hidden
          className="absolute -inset-8 rounded-[999px] bg-[image:var(--gradient-accent)] opacity-40 blur-[70px]"
        />
        <div
          className="@container relative h-full w-full overflow-hidden rounded-[2.2rem] border border-border bg-card"
          style={{ boxShadow: "var(--shadow-device)" }}
        >
          {children}
          {bug}
        </div>
      </div>
    </div>
  );
}

/** Renders one scene inside a portrait stage — the iPhone-shaped App
 *  Screens canvas, or TikTok's 9:16 frame (`canvas: "tiktok"`). Type is sized in
 *  container-width units so the text keeps the same proportion at any
 *  render size — the in-page player, the screenshot export, and the video
 *  recorder all get the same look. */
export function SceneView({
  scene,
  paused,
  elapsedMs = 0,
  hideCaption = false,
  hideTitle = false,
  hideWatermark = false,
  frameless = false,
  canvas = "portrait",
  safeArea = false,
  onEditTitle,
  onPickMedia,
}: {
  scene: Scene;
  /** TikTok canvas: shade where TikTok's own interface will cover the
   *  video (the player's "Safe area" switch; never in exports). */
  safeArea?: boolean;
  /** "tiktok" draws the 9:16 TikTok frame and places pictures by their
   *  TikTok fit; "portrait" is the App Screens canvas. */
  canvas?: PortraitCanvas;
  paused: boolean;
  /** Time into the current slide — drives sequential captions. */
  elapsedMs?: number;
  /** Captions are rendered outside the stage (App Screens presentation). */
  hideCaption?: boolean;
  /** Video presentation: drop the slide title so overlaid captions don't
   *  compete with it. Only applies to scenes with media — on media-less
   *  scenes the title is the visual and always stays. */
  hideTitle?: boolean;
  /** Leave out the brand mark (the cover picker's still of a scene: the
   *  cover draws no mark of its own, and a corner mark rarely suits it). */
  hideWatermark?: boolean;
  /** Drop the device chrome and fill the parent (screenshot export). */
  frameless?: boolean;
  /** Studio editing (paused player only): the title becomes click-to-edit
   *  and commits through this. */
  onEditTitle?: ((value: string) => void) | undefined;
  /** Studio editing: clicking the media area opens the asset picker. */
  onPickMedia?: (() => void) | undefined;
}) {
  const watermark = hideWatermark ? undefined : scene.watermark;
  const media = (
    <SceneMedia
      media={scene.media}
      durationMs={scene.durationMs}
      paused={paused}
      canvas={usesTikTokFit(scene) ? canvas : "portrait"}
      captionStarts={captionStartStyle(scene)}
    />
  );
  /* Editing affordances, rendered inside the slide so they inherit its
   * exact look. The title keeps its element and classes either way; the
   * media areas get an invisible click layer over the whole surface. */
  const title = (className: string) =>
    onEditTitle ? (
      <EditableText
        as="h2"
        value={scene.title ?? ""}
        onCommit={onEditTitle}
        label="Click to edit the title"
        placeholder="Add a title"
        className={className}
      />
    ) : scene.title ? (
      <h2 className={className}>{scene.title}</h2>
    ) : null;
  const pickMedia = onPickMedia ? (
    <button
      type="button"
      aria-label="Choose this scene's media"
      title="Choose media…"
      onClick={(event) => {
        event.stopPropagation();
        onPickMedia();
      }}
      className="absolute inset-0 z-10 cursor-pointer transition-colors hover:bg-foreground/10"
    />
  ) : null;
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
  const placement = captionPlacement(caption?.position, captionPositionClass);
  /* Side margins. On the TikTok canvas the caption stays clear of the
   * like/share buttons down the right 16% and of the 5% a tall phone cuts
   * off the left (TikTokSafeArea.tsx draws both), so it sits a little left
   * of center, like TikTok's own text. A statement slide's text column
   * keeps the same margins. */
  const captionInset = canvas === "tiktok" ? "left-[6%] right-[16%]" : "inset-x-6";
  /* What goes inside the chip: the plain line, or its worded painting. */
  const captionBody =
    body != null &&
    caption != null &&
    (scene.captionStyle === "karaoke" || scene.captionStyle === "reveal") ? (
      <WordLine entry={caption} elapsedMs={elapsedMs} mode={scene.captionStyle} />
    ) : (
      body
    );
  /* Bold white text in per-line chips — captioning, not interface. The
   * generous line-height spaces the cloned chips apart. Chip, text, and
   * spoken-word colors are themeable (colors.caption-* in theme.yaml). */
  const stageCaptionClass =
    "text-[5.2cqw] font-semibold leading-[1.55] text-[color:var(--caption-text,#fff)]";

  /* THEME: statement — centered display text; optional app-mark media
   * above the title, or full-bleed media as a dimmed backdrop behind it. */
  if (scene.theme === "statement") {
    const backdrop = scene.media.kind !== "none" && scene.media.frame === "full";
    return (
      <FixedStage frameless={frameless} watermark={watermark} canvas={canvas} safeArea={safeArea}>
        <div className="relative h-full w-full" style={{ background: "var(--gradient-stage)" }}>
          {backdrop && (
            <>
              <div className="absolute inset-0">
                {media}
                {pickMedia}
              </div>
              <div aria-hidden className="absolute inset-0 bg-background/70" />
            </>
          )}
          <div
            className={cn(
              "absolute inset-0 flex items-center justify-center text-center",
              canvas === "tiktok" ? "pl-[6%] pr-[16%]" : "px-6",
              /* While editing a backdrop scene the media's click layer sits
               * over the whole slide — the text column lifts above it and
               * takes back its own pointer events, so the title stays
               * editable and everywhere else picks media. */
              backdrop && pickMedia && "pointer-events-none z-20",
            )}
          >
            <div
              className={cn(
                "flex max-w-3xl flex-col items-center",
                rise,
                backdrop && pickMedia && "pointer-events-auto",
              )}
            >
              {!backdrop && scene.media.kind !== "none" && (
                <div className="relative mb-10">
                  <div
                    aria-hidden
                    className="scene-glow absolute -inset-8 rounded-full bg-[image:var(--gradient-accent)] opacity-40 blur-[60px]"
                  />
                  <div className="relative size-[36cqw] bg-transparent">
                    {media}
                    {pickMedia}
                  </div>
                </div>
              )}
              {title("font-display text-[10.5cqw] leading-[1.05] tracking-tight text-foreground")}
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
  /* footage is the only theme that never shows a title. `frame: full`
   * elsewhere is a visual treatment — media edge-to-edge, no phone
   * chrome — and the header follows the presentation like any other
   * scene (shown in App Screens, hidden in the overlay presentation). */
  const isFootage = scene.theme === "footage";
  const fullBleed = scene.media.kind !== "none" && (isFootage || scene.media.frame === "full");
  /* A missing title only drops the header when it can't be edited —
   * while editing, the header stays so "Add a title" remains clickable
   * (clearing a title must not remove the way to type a new one). */
  const dropHeader = hasMedia && (isFootage || hideTitle || (!scene.title && !onEditTitle));
  return (
    <FixedStage
      compact={hasMedia}
      frameless={frameless}
      watermark={watermark}
      canvas={canvas}
      safeArea={safeArea}
    >
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
            {title(
              cn(
                "font-display leading-[1.08] tracking-tight text-foreground",
                hasMedia ? "text-[9cqw]" : "text-[10.5cqw]",
              ),
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
             * drawn portrait-first and fill the whole remaining height.
             * With no header (overlay presentation) the band rides in the
             * upper third of the free space instead of the middle — the
             * lower zone belongs to the overlaid captions. */}
            {hideTitle && scene.media.kind !== "graphic" && (
              <div aria-hidden className="min-h-0 flex-1" />
            )}
            <div
              className={cn(
                "relative w-full overflow-hidden",
                drift,
                /* With no header a graphic band spans nearly the whole
                 * stage over its own stage-gradient background, so the
                 * frame would show as two orphaned rules — drop it. In
                 * App Screens the top border divides band from title. */
                (scene.media.kind !== "graphic" || !hideTitle) && "border-y border-border bg-card",
                scene.media.kind === "graphic" && "min-h-0 flex-1",
                /* Graphics center their own content; ceding the bottom of
                 * the band keeps them in the upper zone too. */
                scene.media.kind === "graphic" && hideTitle && "mb-[36cqw]",
              )}
              style={scene.media.kind === "graphic" ? undefined : { aspectRatio: "16 / 10" }}
            >
              {media}
              {pickMedia}
            </div>
            {hideTitle && scene.media.kind !== "graphic" && (
              <div aria-hidden className="min-h-0 flex-[2]" />
            )}
            {body && !hideCaption && (
              <div
                key={captionKey}
                className={cn(
                  "caption-fade absolute text-center",
                  captionInset,
                  placement.className,
                )}
                style={placement.style}
              >
                <p className={stageCaptionClass}>
                  <span className="caption-chip">{captionBody}</span>
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
              !dropHeader &&
                !fullBleed &&
                "mt-7 rounded-t-[1.6rem] border-x border-t border-border",
              !dropHeader && fullBleed && "mt-7",
            )}
          >
            {media}
            {pickMedia}
            {body && !hideCaption && (
              <div
                key={captionKey}
                className={cn(
                  "caption-fade absolute text-center",
                  captionInset,
                  placement.className,
                )}
                style={placement.style}
              >
                <p className={stageCaptionClass}>
                  <span className="caption-chip">{captionBody}</span>
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
