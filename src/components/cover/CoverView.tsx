import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ResolvedCover } from "@/content/showcases";
import type { CoverAnchor, CoverFade, CoverTextSize } from "@/content/cover-rules.mjs";
import {
  COVER_GRID_CROP,
  COVER_LENGTH_BADGE,
  COVER_SPLIT_TEXT_WIDTH,
} from "@/content/cover-rules.mjs";
import { EditableText } from "@/components/studio/EditableText";

/* A showcase's cover, drawn in its destination's frame (`cover.frame`:
 * 9:16, or 16:9 for the regular YouTube video's thumbnail): the picture,
 * the text and the graphics, in one of the cover layouts
 * (src/content/cover-rules.mjs). Everything is sized in container units
 * of the frame's shorter side (cqmin), so the same drawing serves the
 * Cover page, the home card and the saved image
 * (/showcase/<id>/cover/still), which the studio captures at the frame's
 * size.
 *
 *   fade    the picture fills the frame; the text sits over a dark fade
 *   band    the picture fills the frame; the text sits in a band of the
 *           theme's primary color
 *   split   9:16: the text where it needs, the picture shown whole in
 *           the rest. 16:9: the text on the left, the picture filling
 *           the right, cropped by its focus.
 *
 *   9:16 split          16:9 split
 *   ┌────────┐          ┌──────────┬──────────┐
 *   │Headline│          │ Headline │ picture  │
 *   │picture │          │          │ (fills)  │
 *   └────────┘          └──────────┴──────────┘
 *
 * At 9:16, text and graphics are placed inside the middle 3:4, which is
 * what TikTok's and Instagram's profile grids show. `marks` shades what
 * the platform cuts off or draws over: the grids' crop at 9:16, the video
 * length YouTube puts in the bottom-right corner at 16:9. Colors and fonts
 * come from the showcase's theme (the CSS variables its layout route
 * sets).
 *
 * The headline is the cover's only text: a second line would compete
 * with it at thumbnail size, and anything more is a graphic.
 *
 * With `edit` the headline is click-to-edit and the picture
 * opens the asset picker; without it the cover is only drawn. */

/** How far in from the top and bottom text and graphics stay: inside the
 *  grid crop at 9:16; a 16:9 thumbnail isn't cropped. */
const safeInset = (landscape: boolean) => (landscape ? "0%" : `${COVER_GRID_CROP}%`);

const HEADLINE_SIZE: Record<CoverTextSize, string> = {
  s: "text-[7cqmin]",
  m: "text-[9cqmin]",
  l: "text-[11.5cqmin]",
};

/** Where a graphic's box sits, inside the grid crop at 9:16. Its width
 *  is a share of the frame's shorter side. */
function anchorStyle(at: CoverAnchor, size: number, landscape: boolean): CSSProperties {
  const safe = safeInset(landscape);
  const [row, column] = at.includes("-")
    ? (at.split("-") as [string, string])
    : at === "left" || at === "right"
      ? ["middle", at]
      : at === "top" || at === "bottom"
        ? [at, "center"]
        : ["middle", "center"];
  const style: CSSProperties = { width: `${size}cqmin` };
  const inset = landscape ? "3%" : "5%";
  if (row === "top") style.top = `calc(${safe} + ${landscape ? 5 : 3}%)`;
  else if (row === "bottom") style.bottom = `calc(${safe} + ${landscape ? 5 : 3}%)`;
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

/* The fade layout's darkening, by strength: at the frame's edge on the
 * text's side, then at 32% and 50% of the way across, and where it is
 * clear. Darkest where the text sits (just inside the grid crop), so
 * white text reads over a bright picture. With the text in the middle,
 * an even darkening instead. */
const FADES: Record<
  CoverFade,
  { edge: number; near: number; mid: number; clear: string; even: number }
> = {
  light: { edge: 0.6, near: 0.45, mid: 0.15, clear: "58%", even: 0.28 },
  medium: { edge: 0.85, near: 0.75, mid: 0.35, clear: "66%", even: 0.45 },
  strong: { edge: 0.94, near: 0.88, mid: 0.6, clear: "80%", even: 0.62 },
};

function fadeBackground(fade: CoverFade, position: "top" | "middle" | "bottom"): string {
  const f = FADES[fade];
  if (position === "middle") return `rgb(0 0 0 / ${f.even})`;
  return (
    `linear-gradient(to ${position === "top" ? "bottom" : "top"}, rgb(0 0 0 / ${f.edge}), ` +
    `rgb(0 0 0 / ${f.near}) 32%, rgb(0 0 0 / ${f.mid}) 50%, transparent ${f.clear})`
  );
}

export type CoverEditing = {
  onHeadline: (value: string) => void;
  onPickPicture: () => void;
};

export function CoverView({
  cover,
  marks = false,
  edit,
  className,
}: {
  cover: ResolvedCover;
  /** Shade what the platform cuts off or draws over: the top and bottom
   *  the profile grids cut off (9:16), or the video length (16:9). */
  marks?: boolean;
  edit?: CoverEditing | undefined;
  className?: string;
}) {
  const landscape = cover.frame.width > cover.frame.height;
  const safe = safeInset(landscape);
  const position =
    cover.layout === "split" && cover.textPosition === "middle" && !landscape
      ? "top"
      : cover.textPosition;
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
      className="absolute inset-0 h-full w-full object-cover"
      style={{
        objectPosition:
          cover.focus === "left" || cover.focus === "right"
            ? `${cover.focus} center`
            : `center ${cover.focus}`,
      }}
    />
  ) : (
    <div className="absolute inset-0 flex items-center justify-center text-[4cqmin] text-foreground/40">
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
      className={cn("relative overflow-hidden bg-card", className)}
      /* A size container, not just an inline-size one: cqmin has to read
       * this frame's height too, not the height of a box around it. */
      style={{
        containerType: "size",
        aspectRatio: `${cover.frame.width} / ${cover.frame.height}`,
        background: "var(--gradient-stage)",
      }}
    >
      {cover.layout === "split" && landscape ? (
        /* Side by side: the text in a column on the left, placed up or
         * down by its position; the picture filling the rest, cropped
         * by its focus — shown whole, a phone picture would be a narrow
         * strip with empty bands beside it. */
        <div className="absolute inset-0 flex">
          <div
            className={cn(
              "flex shrink-0 flex-col px-[7cqmin] py-[6cqmin]",
              position === "top"
                ? "justify-start"
                : position === "bottom"
                  ? "justify-end"
                  : "justify-center",
            )}
            style={{ width: `${COVER_SPLIT_TEXT_WIDTH}%` }}
          >
            {text}
          </div>
          {pictureArea(picture, "relative h-full min-w-0 flex-1")}
        </div>
      ) : cover.layout === "split" ? (
        /* The text takes the room it needs, just inside the grid crop;
         * the picture, shown whole, takes the rest — out to the frame's
         * edge on its side, and snug against the text. */
        <div
          className={cn(
            "absolute inset-x-0 flex",
            position === "top" ? "bottom-0 flex-col" : "top-0 flex-col-reverse",
          )}
          /* Inset with top/bottom, not padding: a padding percentage
           * is a share of the frame's width, not its height. */
          style={position === "top" ? { top: safe } : { bottom: safe }}
        >
          <div className="shrink-0 px-[7cqmin] py-[4cqmin]">{text}</div>
          {pictureArea(
            cover.pictureUrl ? (
              <img
                src={cover.pictureUrl}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full object-contain"
                style={{ objectPosition: position === "top" ? "center top" : "center bottom" }}
              />
            ) : (
              picture
            ),
            "relative min-h-0 w-full flex-1",
          )}
        </div>
      ) : (
        <>
          {pictureArea(picture, "inset-0")}
          {cover.layout === "fade" && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0"
              style={{ background: fadeBackground(cover.fade, position) }}
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
            style={{ top: safe, bottom: safe }}
          >
            <div
              className={cn(
                "pointer-events-auto w-full",
                cover.layout === "band"
                  ? "bg-primary px-[7cqmin] py-[5cqmin] text-primary-foreground"
                  : "px-[7cqmin] py-[4cqmin] text-white",
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
          style={anchorStyle(item.at, item.size, landscape)}
        >
          {item.component ? (
            <item.component />
          ) : (
            <div className="flex h-full w-full items-center justify-center rounded-[2cqmin] border border-dashed border-foreground/40 p-[2cqmin] text-center text-[3cqmin] text-foreground/60">
              no graphic “{item.key}”
            </div>
          )}
        </div>
      ))}
      {marks && (landscape ? <LengthBadge /> : <GridCrop />)}
    </div>
  );
}

/** A cover as large as fits in the box this fills, at its frame's shape,
 *  centered: a 9:16 cover takes the height, a 16:9 one the width, until
 *  the other side runs out. */
export function CoverFit({
  className,
  children,
  frame,
}: {
  className?: string;
  /** The cover's frame, for its shape. */
  frame: { width: number; height: number };
  children: ReactNode;
}) {
  return (
    <div
      className={cn("flex items-center justify-center", className)}
      style={{ containerType: "size" }}
    >
      <div style={{ width: `min(100cqw, 100cqh * ${frame.width} / ${frame.height})` }}>
        {children}
      </div>
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
  const shadow =
    onBand || split ? undefined : { textShadow: "0 0.4cqmin 2cqmin rgb(0 0 0 / 0.55)" };
  /* The line height comes after the size: tailwind-merge drops a leading
   * class that a later text size could override. */
  const headlineClass = cn(
    "block font-display tracking-tight",
    HEADLINE_SIZE[cover.textSize],
    "leading-[1.02]",
    split && "text-foreground",
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
      </div>
    );
  }
  return (
    <div style={shadow}>
      {cover.headline && <h2 className={headlineClass}>{cover.headline}</h2>}
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
          <span className="rounded bg-black/60 px-[1.5cqmin] py-[0.5cqmin] text-[3cqmin] text-amber-100">
            Cut off in the profile grid
          </span>
        </div>
      ))}
    </div>
  );
}

/** The bottom-right corner where YouTube draws the video's length over
 *  the thumbnail — shown on the Cover page, never in the saved image. */
function LengthBadge() {
  const { right, bottom, width, height } = COVER_LENGTH_BADGE;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 flex items-center justify-center rounded-[1cqmin] border border-dashed border-amber-300/70 bg-amber-400/25"
      style={{ right: `${right}%`, bottom: `${bottom}%`, width: `${width}%`, height: `${height}%` }}
    >
      <span className="rounded bg-black/60 px-[1.5cqmin] py-[0.5cqmin] text-[2.6cqmin] text-amber-100">
        Video length
      </span>
    </div>
  );
}
