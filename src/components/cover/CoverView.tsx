import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ResolvedCover } from "@/content/showcases";
import type { CoverAnchor, CoverTextSize } from "@/content/cover-rules.mjs";
import { COVER_GRID_CROP } from "@/content/cover-rules.mjs";
import { EditableText } from "@/components/studio/EditableText";

/* A showcase's cover, drawn in a 9:16 box: the picture, the text and the
 * graphics, in one of the cover layouts (src/content/cover-rules.mjs).
 * Everything is sized in container units, so the same drawing serves the
 * Cover page, the home card and the saved PNG
 * (/showcase/<id>/cover/still), which the studio captures at 1080×1920.
 *
 *   fade    the picture fills the frame; the text sits over a dark fade
 *   band    the picture fills the frame; the text sits in a band of the
 *           theme's primary color
 *   split   the picture in one half, shown whole; the text in the other
 *
 * Text and graphics are placed inside the middle 3:4, which is what
 * TikTok's and Instagram's profile grids show; `gridCrop` shades what
 * those grids cut off. Colors and fonts come from the showcase's theme
 * (the CSS variables its layout route sets).
 *
 * With `edit` the headline and subhead are click-to-edit and the picture
 * opens the asset picker; without it the cover is only drawn. */

const SAFE_TOP = `${COVER_GRID_CROP}%`;
const SAFE_BOTTOM = `${COVER_GRID_CROP}%`;

const HEADLINE_SIZE: Record<CoverTextSize, string> = {
  s: "text-[7cqw]",
  m: "text-[9cqw]",
  l: "text-[11.5cqw]",
};
const SUBHEAD_SIZE: Record<CoverTextSize, string> = {
  s: "text-[4cqw]",
  m: "text-[4.8cqw]",
  l: "text-[5.6cqw]",
};

/** Where a graphic's box sits, inside the grid crop. */
function anchorStyle(at: CoverAnchor, size: number): CSSProperties {
  const [row, column] = at.includes("-")
    ? (at.split("-") as [string, string])
    : at === "left" || at === "right"
      ? ["middle", at]
      : at === "top" || at === "bottom"
        ? [at, "center"]
        : ["middle", "center"];
  const style: CSSProperties = { width: `${size}%` };
  const inset = "5%";
  if (row === "top") style.top = `calc(${SAFE_TOP} + 3%)`;
  else if (row === "bottom") style.bottom = `calc(${SAFE_BOTTOM} + 3%)`;
  else {
    style.top = "50%";
    style.translate = "0 -50%";
  }
  if (column === "left") style.left = inset;
  else if (column === "right") style.right = inset;
  else {
    style.left = "50%";
    style.translate = `-50% ${row === "middle" ? "-50%" : "0"}`;
  }
  return style;
}

export type CoverEditing = {
  onHeadline: (value: string) => void;
  onSubhead: (value: string) => void;
  onPickPicture: () => void;
};

export function CoverView({
  cover,
  gridCrop = false,
  edit,
  className,
}: {
  cover: ResolvedCover;
  /** Shade the top and bottom that the profile grids cut off. */
  gridCrop?: boolean;
  edit?: CoverEditing | undefined;
  className?: string;
}) {
  const position =
    cover.layout === "split" && cover.textPosition === "middle" ? "top" : cover.textPosition;
  const text = (
    <CoverText
      cover={cover}
      edit={edit}
      onBand={cover.layout === "band"}
      split={cover.layout === "split"}
    />
  );
  const picture = cover.pictureUrl ? (
    <img
      src={cover.pictureUrl}
      alt=""
      draggable={false}
      className={cn(
        "absolute inset-0 h-full w-full",
        cover.layout === "split" ? "object-contain" : "object-cover",
      )}
      style={{ objectPosition: `center ${cover.focus}` }}
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center text-[4cqw] text-foreground/40">
      {edit ? "Click to choose a picture" : "No picture"}
    </div>
  );
  const pictureArea = (children: ReactNode, extra?: string) =>
    edit ? (
      <button
        type="button"
        aria-label="Change the cover picture"
        title="Change the picture"
        onClick={(event) => {
          event.stopPropagation();
          edit.onPickPicture();
        }}
        className={cn("absolute cursor-pointer", extra)}
      >
        {children}
      </button>
    ) : (
      <div className={cn("absolute", extra)}>{children}</div>
    );

  return (
    <div
      className={cn("@container relative aspect-[9/16] overflow-hidden bg-card", className)}
      style={{ background: "var(--gradient-stage)" }}
    >
      {cover.layout === "split" ? (
        <>
          {pictureArea(
            picture,
            position === "top"
              ? "inset-x-0 bottom-[12.5%] top-1/2"
              : "inset-x-0 top-[12.5%] bottom-1/2",
          )}
          <div
            className={cn(
              "absolute inset-x-0 flex flex-col justify-center px-[7cqw]",
              position === "top" ? "top-[12.5%] bottom-1/2" : "top-1/2 bottom-[12.5%]",
            )}
          >
            {text}
          </div>
        </>
      ) : (
        <>
          {pictureArea(picture, "inset-0")}
          {cover.layout === "fade" && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{
                /* Darkest where the text sits (just inside the grid
                 * crop), so it reads over a bright picture too. */
                background:
                  position === "middle"
                    ? "rgb(0 0 0 / 0.45)"
                    : `linear-gradient(to ${position === "top" ? "bottom" : "top"}, rgb(0 0 0 / 0.85), rgb(0 0 0 / 0.75) 32%, rgb(0 0 0 / 0.35) 50%, transparent 66%)`,
              }}
            />
          )}
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 flex",
              position === "top"
                ? "items-start"
                : position === "bottom"
                  ? "items-end"
                  : "items-center",
            )}
            style={{ top: SAFE_TOP, bottom: SAFE_BOTTOM }}
          >
            <div
              className={cn(
                "pointer-events-auto w-full",
                cover.layout === "band"
                  ? "bg-primary px-[7cqw] py-[5cqw] text-primary-foreground"
                  : "px-[7cqw] py-[4cqw] text-white",
              )}
            >
              {text}
            </div>
          </div>
        </>
      )}
      {cover.graphics.map((item, i) => (
        <div
          key={`${item.key}-${i}`}
          className="pointer-events-none absolute aspect-square"
          style={anchorStyle(item.at, item.size)}
        >
          {item.component ? (
            <item.component />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-[2cqw] border border-dashed border-foreground/40 p-[2cqw] text-center text-[3cqw] text-foreground/60">
              no graphic “{item.key}”
            </div>
          )}
        </div>
      ))}
      {gridCrop && <GridCrop />}
    </div>
  );
}

function CoverText({
  cover,
  edit,
  onBand,
  split,
}: {
  cover: ResolvedCover;
  edit?: CoverEditing | undefined;
  onBand: boolean;
  split: boolean;
}) {
  const shadow = onBand || split ? undefined : { textShadow: "0 0.4cqw 2cqw rgb(0 0 0 / 0.55)" };
  const headlineClass = cn(
    "block font-display leading-[1.02] tracking-tight",
    HEADLINE_SIZE[cover.textSize],
    split && "text-foreground",
  );
  const subheadClass = cn(
    "mt-[2.5cqw] block leading-snug",
    SUBHEAD_SIZE[cover.textSize],
    split ? "text-muted-foreground" : "opacity-90",
  );
  if (edit) {
    return (
      <div style={shadow}>
        <EditableText
          as="h2"
          value={cover.headline ?? ""}
          onCommit={edit.onHeadline}
          label="Cover headline"
          placeholder="Headline"
          className={headlineClass}
        />
        <EditableText
          as="p"
          value={cover.subhead ?? ""}
          onCommit={edit.onSubhead}
          label="Cover subhead"
          placeholder="Subhead (optional)"
          className={subheadClass}
        />
      </div>
    );
  }
  return (
    <div style={shadow}>
      {cover.headline && <h2 className={headlineClass}>{cover.headline}</h2>}
      {cover.subhead && <p className={subheadClass}>{cover.subhead}</p>}
    </div>
  );
}

/** The top and bottom of the frame that TikTok's and Instagram's profile
 *  grids cut off — shown on the Cover page, never in the saved image. */
function GridCrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-30">
      {(["top", "bottom"] as const).map((side) => (
        <div
          key={side}
          className="absolute inset-x-0 flex items-center justify-center border-dashed border-amber-300/70 bg-amber-400/25"
          style={{
            [side]: 0,
            height: `${COVER_GRID_CROP}%`,
            [side === "top" ? "borderBottomWidth" : "borderTopWidth"]: 1,
          }}
        >
          <span className="rounded bg-black/60 px-[1.5cqw] py-[0.5cqw] text-[3cqw] text-amber-100">
            Cut off in the profile grid
          </span>
        </div>
      ))}
    </div>
  );
}
