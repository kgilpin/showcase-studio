import type { Watermark } from "@/content/watermark";

/* The persistent brand mark — see src/content/watermark.ts for the model.
 * Drawn inside the stage, over everything, in one corner. Sizes are in
 * container-width units so the bug keeps the same proportion in the
 * player, the screenshot export, and the video recorder alike; each
 * canvas has its own base size because the two frames are different
 * shapes (1320×2868 portrait, 1080×1920 TikTok, 1440×1080 embed). The
 * two portrait frames are close enough in width to share a size. */
const SIZES = {
  portrait: { mark: 9, text: 4, gap: 1.8, inset: 5 },
  tiktok: { mark: 9, text: 4, gap: 1.8, inset: 5 },
  embed: { mark: 5, text: 2.4, gap: 1.1, inset: 3 },
};

/** A tight halo plus a soft drop shadow, so the mark stays legible over a
 *  bright or busy frame — a white wordmark on a pale wall or sky would
 *  otherwise wash out. Sized in container units, like the mark, so it is
 *  as strong in the 1320-wide export as in the small player. */
const SHADOW =
  "drop-shadow(0 0 0.2cqw rgba(0,0,0,0.7)) drop-shadow(0 0.2cqw 0.9cqw rgba(0,0,0,0.55))";

export function SceneWatermark({
  watermark,
  canvas = "portrait",
}: {
  watermark: Watermark | undefined;
  canvas?: "portrait" | "tiktok" | "embed";
}) {
  /* A mark whose image has no file and that has no wordmark draws nothing. */
  if (!watermark || (!watermark.src && !watermark.text)) return null;
  const size = SIZES[canvas];
  const scale = watermark.scale;
  const inset = `${size.inset}cqw`;
  /* An authored inset pushes the mark down (or up) to a height in percent
   * of the frame — past a platform's own interface — the same in every
   * format; the side inset stays the canvas's own. */
  const edge = watermark.inset != null ? `${watermark.inset}%` : inset;
  const shade = watermark.shade ?? 0;
  const [vertical, horizontal] = watermark.position.split("-");
  return (
    /* Decorative chrome: hidden from screen readers so the same logo
     * isn't announced on every slide, and click-through so it never
     * steals a tap from the studio's editing affordances. */
    <div
      aria-hidden
      className="pointer-events-none absolute z-30 flex select-none items-center"
      style={{
        opacity: watermark.opacity,
        gap: `${size.gap * scale}cqw`,
        ...(vertical === "top" ? { top: edge } : { bottom: edge }),
        ...(horizontal === "left" ? { left: inset } : { right: inset }),
        /* The shade: a dark rounded panel behind the mark, for footage
         * where the drop shadow alone doesn't keep it legible. */
        ...(shade > 0
          ? {
              padding: `${size.gap * 0.6 * scale}cqw ${size.gap * scale}cqw`,
              borderRadius: "9999px",
              background: `rgba(0, 0, 0, ${shade})`,
            }
          : {}),
      }}
    >
      {watermark.src && (
        <img
          src={watermark.src}
          alt=""
          className="w-auto object-contain"
          style={{ height: `${size.mark * scale}cqw`, filter: SHADOW }}
        />
      )}
      {watermark.text && (
        <span
          className="font-display font-semibold leading-none tracking-tight text-[color:var(--watermark-text,#fff)]"
          style={{ fontSize: `${size.text * scale}cqw`, filter: SHADOW }}
        >
          {watermark.text}
        </span>
      )}
    </div>
  );
}
