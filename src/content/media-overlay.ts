/* Where a picture actually lands inside its media box, so an overlay
 * (media.overlay) can sit exactly on it.
 *
 *   media box (container)          the picture as shown
 *   ┌──────────────────────┐       ┌──────────────────────┐
 *   │                      │       │   band               │
 *   │  object-fit +        │  ──►  │ ┌──────────────────┐ │ ◄ overlay box:
 *   │  object-position     │       │ │     picture      │ │   left, top,
 *   │                      │       │ └──────────────────┘ │   width, height
 *   └──────────────────────┘       └──────────────────────┘
 *
 * The same rules the browser uses for <img>/<video>: "contain" scales the
 * picture to fit inside the box, "cover" scales it to fill the box and
 * crops the rest; the position (0-100% on each axis) says where the spare
 * room — or the cropped part — goes. With cover the box can be larger
 * than the container; the media box clips it. */

export type OverlayRect = { left: number; top: number; width: number; height: number };

export function pictureRect(
  container: { width: number; height: number },
  picture: { width: number; height: number },
  fit: "contain" | "cover",
  position: { x: number; y: number },
): OverlayRect | undefined {
  if (!(container.width > 0 && container.height > 0 && picture.width > 0 && picture.height > 0)) {
    return undefined;
  }
  const scaleX = container.width / picture.width;
  const scaleY = container.height / picture.height;
  const scale = fit === "contain" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
  const width = picture.width * scale;
  const height = picture.height * scale;
  return {
    left: ((container.width - width) * position.x) / 100,
    top: ((container.height - height) * position.y) / 100,
    width,
    height,
  };
}
