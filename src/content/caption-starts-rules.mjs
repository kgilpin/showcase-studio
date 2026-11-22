/* A graphic can start an animation when a caption starts (issue #84).
 *
 *   showcase.yaml   - {id: missing, text: "If there isn't…"}
 *                          │
 *                          ▼  captionTimeline
 *   on the graphic  --caption-missing-start: 8300ms
 *                          │
 *                          ▼
 *   graphic's CSS   animation-delay: var(--caption-missing-start)
 *
 * Captions go by name and not by number: with numbers, a caption inserted
 * or moved would hand its graphic's timing to a different line.
 *
 * Shared by the loader (warnings), the edit tool, the player and
 * validate. Types: caption-starts-rules.d.mts.
 */
import { captionTimeline } from "./timing.mjs";

/** A caption's id: part of a CSS variable's name, and never just a number. */
export const CAPTION_ID_PATTERN = "^[a-z][a-z0-9]*(-[a-z0-9]+)*$";
const ID = new RegExp(CAPTION_ID_PATTERN);
export const CAPTION_ID_HELP =
  'lowercase words joined by hyphens, starting with a letter, like "missing-test"';

export function isCaptionId(value) {
  return typeof value === "string" && ID.test(value);
}

/** The CSS variable that holds a caption's start, from the scene's start. */
export function captionStartVariable(id) {
  return `--caption-${id}-start`;
}

/** The style that gives a graphic its scene's caption starts. */
export function captionStartStyle(scene) {
  const style = {};
  for (const caption of captionTimeline(scene)) {
    if (!isCaptionId(caption.id)) continue;
    const name = captionStartVariable(caption.id);
    /* Of two captions with one id the first counts; the loader warns. */
    style[name] ??= `${Math.round(caption.startMs)}ms`;
  }
  return style;
}

/** What is wrong with a scene's caption ids. */
export function captionIdProblems(captions) {
  const problems = [];
  const seen = new Set();
  captions.forEach((caption, i) => {
    if (caption?.id == null) return;
    if (!isCaptionId(caption.id)) {
      problems.push(`captions[${i}].id "${caption.id}" isn't a name: ${CAPTION_ID_HELP}`);
    } else if (seen.has(caption.id)) {
      problems.push(`captions[${i}].id "${caption.id}" is used twice in the scene`);
    }
    seen.add(caption?.id);
  });
  return problems;
}

/** The caption names a graphic's source times itself to. */
export function captionStartsUsed(source) {
  const used = source.matchAll(/var\(\s*--caption-([a-z0-9-]+)-start\b/g);
  return [...new Set([...used].map((match) => match[1]))];
}

/** A warning for each name a graphic uses that no caption in its scene
 *  has. CSS alone says nothing: the part just appears at once. */
export function missingCaptionStarts({ graphic, source, captions }) {
  const ids = new Set(captions.map((caption) => caption?.id));
  return captionStartsUsed(source)
    .filter((id) => !ids.has(id))
    .map(
      (id) =>
        `graphic "${graphic}" waits for ${captionStartVariable(id)}, and no caption in this ` +
        `scene has id: ${id}, so that part appears at once. Put the id on the caption it ` +
        "belongs to, or change the graphic.",
    );
}
