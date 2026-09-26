import { cn } from "@/lib/utils";
import { activeCaption, type Scene } from "@/content/showcases";
import type { CaptionPreset } from "@/content/caption-position-rules.mjs";
import { SceneMedia } from "./SceneMedia";
import { captionPlacement } from "./caption-placement";
import { SceneWatermark } from "./SceneWatermark";
import { CtaContent, WordLine } from "./SceneView";

/* The 4:3 embed canvas — the YouTube/desktop rendition of a showcase.
 * Same scene model, compositions arranged for a wide frame:
 *
 *   statement  centered column, as portrait (wider measure)
 *   feature    text panel (eyebrow, title, caption) beside the
 *              full-height phone media
 *   footage    the spoken line in a text panel beside the full-height
 *              clip — no text over the speaker
 *   console    title header over the landscape media band — the canvas
 *              this theme always wanted; captions overlay the media
 *              unless the showcase's embedCaptions setting is off
 *
 * Rendered by the record page with ?canvas=embed; the exporter opens it
 * at 1440×1080. Type is sized in container-width units, matching the
 * portrait canvas's approach. */
export const EMBED_ASPECT = "4 / 3";

const chipPlacement: Record<CaptionPreset, string> = {
  top: "top-[6%]",
  center: "top-1/2 -translate-y-1/2",
  lower: "top-[60%] -translate-y-1/2",
  bottom: "bottom-[8%]",
};

export function EmbedSceneView({
  scene,
  paused,
  elapsedMs = 0,
  captions = true,
}: {
  scene: Scene;
  paused: boolean;
  elapsedMs?: number;
  /** Overlay captions on the console layout's media (the showcase's
   *  embedCaptions setting). The other layouts set the spoken line as
   *  text in the composition, not over the media, so it always stays. */
  captions?: boolean;
}) {
  const media = <SceneMedia media={scene.media} durationMs={scene.durationMs} paused={paused} />;
  const caption = activeCaption(scene, elapsedMs);
  const spoken = caption?.text ?? scene.body;
  /* As in portrait: a caption that duplicates the displayed title stays
   * off the slide. */
  const body = spoken === scene.title ? undefined : spoken;
  const captionKey = caption?.text ?? "body";
  const placement = captionPlacement(caption?.position, chipPlacement);

  const chips = body && (
    <div
      key={captionKey}
      className={cn("caption-fade absolute inset-x-[6%] text-center", placement.className)}
      style={placement.style}
    >
      <p className="text-[2.6cqw] font-semibold leading-[1.55] text-[color:var(--caption-text,#fff)]">
        <span className="caption-chip">
          {caption != null &&
          (scene.captionStyle === "karaoke" || scene.captionStyle === "reveal") ? (
            <WordLine entry={caption} elapsedMs={elapsedMs} mode={scene.captionStyle} />
          ) : (
            body
          )}
        </span>
      </p>
    </div>
  );

  if (scene.theme === "statement") {
    const backdrop = scene.media.kind !== "none" && scene.media.frame === "full";
    return (
      <Stage watermark={scene.watermark}>
        {backdrop && (
          <>
            <div className="absolute inset-0">{media}</div>
            <div aria-hidden className="absolute inset-0 bg-background/70" />
          </>
        )}
        <div className="absolute inset-0 flex items-center justify-center px-[8cqw] text-center">
          <div className="flex flex-col items-center">
            {!backdrop && scene.media.kind !== "none" && (
              <div className="relative mb-[2.5cqw]">
                <div
                  aria-hidden
                  className="scene-glow absolute -inset-8 rounded-full bg-[image:var(--gradient-accent)] opacity-40 blur-[60px]"
                />
                <div className="relative size-[14cqw] bg-transparent">{media}</div>
              </div>
            )}
            {scene.title && (
              <h2 className="font-display text-[6.5cqw] leading-[1.05] tracking-tight text-foreground">
                {scene.title}
              </h2>
            )}
            {body && <p className="mt-[1.5cqw] text-[3cqw] text-muted-foreground">{body}</p>}
            {scene.support && (
              <p className="mt-[1.8cqw] text-[2.4cqw] leading-relaxed text-support">
                {scene.support}
              </p>
            )}
            {scene.cta && (
              <a
                href={scene.cta.url}
                target="_blank"
                rel="noreferrer"
                className="mt-[2.5cqw] inline-block"
              >
                <CtaContent
                  cta={scene.cta}
                  badgeClass="h-[5.5cqw] w-auto"
                  pillClass="px-[3cqw] py-[1.3cqw] text-[2.2cqw]"
                />
              </a>
            )}
            {scene.ctaNote && (
              <p className="mt-[1.2cqw] text-[1.9cqw] text-support">{scene.ctaNote}</p>
            )}
          </div>
        </div>
      </Stage>
    );
  }

  if (scene.theme === "footage") {
    /* Side-by-side, like feature: the spoken line gets the panel instead
     * of covering the speaker. */
    return (
      <Stage watermark={scene.watermark}>
        <div className="flex h-full w-full">
          {/* Eyebrows stay off slides (they label the script pages). */}
          <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.8cqw] px-[5cqw] text-left">
            {body && (
              <p
                key={captionKey}
                className="caption-fade text-[3.2cqw] leading-relaxed text-foreground"
              >
                {body}
              </p>
            )}
          </div>
          {scene.media.kind !== "none" && (
            <div className="flex h-full shrink-0 items-center py-[3cqh] pr-[3.5cqw]">
              <div
                className="relative h-full overflow-hidden rounded-[1.6cqw] border border-border bg-card"
                style={{ aspectRatio: "9 / 16" }}
              >
                {media}
              </div>
            </div>
          )}
        </div>
      </Stage>
    );
  }

  if (scene.theme === "console") {
    return (
      <Stage watermark={scene.watermark}>
        <div className="flex h-full w-full flex-col">
          {scene.title && (
            <div className="shrink-0 px-[4cqw] pt-[2.6cqw] text-center">
              <h2 className="font-display text-[4.2cqw] leading-[1.08] tracking-tight text-foreground">
                {scene.title}
              </h2>
            </div>
          )}
          <div className="relative m-[3cqw] mt-[2.2cqw] min-h-0 flex-1 overflow-hidden rounded-[1cqw] border border-border bg-card">
            {media}
            {captions && chips}
          </div>
        </div>
      </Stage>
    );
  }

  /* feature: text panel beside the full-height phone media. */
  return (
    <Stage watermark={scene.watermark}>
      <div className="flex h-full w-full">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.6cqw] px-[5cqw] text-left">
          {scene.title && (
            <h2 className="font-display text-[4.6cqw] leading-[1.08] tracking-tight text-foreground">
              {scene.title}
            </h2>
          )}
          {body && (
            <p
              key={captionKey}
              className="caption-fade text-[2.6cqw] leading-relaxed text-muted-foreground"
            >
              {body}
            </p>
          )}
        </div>
        {scene.media.kind !== "none" && (
          <div className="flex h-full shrink-0 items-center py-[3cqh] pr-[3.5cqw]">
            <div
              className="relative h-full overflow-hidden rounded-[1.6cqw] border border-border bg-card"
              style={{ aspectRatio: "1320 / 2868" }}
            >
              {media}
            </div>
          </div>
        )}
      </div>
    </Stage>
  );
}

function Stage({
  children,
  watermark,
}: {
  children: React.ReactNode;
  /** The scene's brand mark, in a corner over every layout. */
  watermark?: Scene["watermark"];
}) {
  return (
    <div
      className="@container absolute inset-0 overflow-hidden"
      style={{ background: "var(--gradient-stage)" }}
    >
      {children}
      <SceneWatermark watermark={watermark} canvas="embed" />
    </div>
  );
}
