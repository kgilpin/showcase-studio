import { cn } from "@/lib/utils";
import { activeCaption, type CaptionPosition, type Scene } from "@/content/showcases";
import { SceneMedia } from "./SceneMedia";
import { CtaContent } from "./SceneView";

/* The 4:3 embed canvas — the YouTube/desktop rendition of a showcase.
 * Same scene model, compositions arranged for a wide frame:
 *
 *   statement  centered column, as portrait (wider measure)
 *   feature    text panel (eyebrow, title, caption) beside the
 *              full-height phone media
 *   footage    the portrait clip centered at full height, stage
 *              gradient filling the sides, caption chips on the clip
 *   console    title header over the landscape media band — the canvas
 *              this theme always wanted
 *
 * Rendered by the record page with ?canvas=embed; the exporter opens it
 * at 1440×1080. Type is sized in container-width units, matching the
 * portrait canvas's approach. */
export const EMBED_ASPECT = "4 / 3";

const chipPlacement: Record<CaptionPosition, string> = {
  top: "top-[6%]",
  center: "top-1/2 -translate-y-1/2",
  lower: "top-[60%] -translate-y-1/2",
  bottom: "bottom-[8%]",
};

export function EmbedSceneView({
  scene,
  paused,
  elapsedMs = 0,
}: {
  scene: Scene;
  paused: boolean;
  elapsedMs?: number;
}) {
  const media = <SceneMedia media={scene.media} durationMs={scene.durationMs} paused={paused} />;
  const caption = activeCaption(scene, elapsedMs);
  const spoken = caption?.text ?? scene.body;
  /* As in portrait: a caption that duplicates the displayed title stays
   * off the slide. */
  const body = spoken === scene.title ? undefined : spoken;
  const captionKey = caption?.text ?? "body";

  const chips = body && (
    <div
      key={captionKey}
      className={cn(
        "caption-fade absolute inset-x-[6%] text-center",
        chipPlacement[caption?.position ?? "bottom"],
      )}
    >
      <p className="text-[2.6cqw] font-semibold leading-[1.55] text-white">
        <span className="caption-chip">{body}</span>
      </p>
    </div>
  );

  if (scene.theme === "statement") {
    const backdrop = scene.media.kind !== "none" && scene.media.frame === "full";
    return (
      <Stage>
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
                  className="scene-glow absolute -inset-8 rounded-full bg-[var(--gradient-accent)] opacity-40 blur-[60px]"
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
    return (
      <Stage>
        <div
          className="absolute inset-y-0 left-1/2 -translate-x-1/2 overflow-hidden"
          style={{ aspectRatio: "9 / 16" }}
        >
          <div className="relative h-full w-full">{media}</div>
          {chips}
        </div>
      </Stage>
    );
  }

  if (scene.theme === "console") {
    return (
      <Stage>
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
            {chips}
          </div>
        </div>
      </Stage>
    );
  }

  /* feature: text panel beside the full-height phone media. */
  return (
    <Stage>
      <div className="flex h-full w-full">
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-[1.6cqw] px-[5cqw] text-left">
          {scene.eyebrow && (
            <p className="text-[1.7cqw] uppercase tracking-[0.42em] text-primary">
              {scene.eyebrow}
            </p>
          )}
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

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="@container absolute inset-0 overflow-hidden"
      style={{ background: "var(--gradient-stage)" }}
    >
      {children}
    </div>
  );
}
