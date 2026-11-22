/* Puts the record page's animations and videos at a moment in a scene.
 * The answer depends only on that moment, so a screenshot that goes
 * straight to 0:14 shows what the export shows after playing up to 0:14.
 *
 *   scene     0 ───────────────────────────────► elapsedMs
 *   picture, graphic, overlay, video: started with the scene
 *
 *   caption   0 ─── caption 1 ───┬─── caption 2 ─► elapsedMs
 *   its fade-in:                 started with the caption on screen
 *
 * A start time is never taken from when the page first saw an animation:
 * after a jump, that is the moment jumped to, not the start.
 *
 * Only animations that exist can be placed. Chrome creates those inside
 * a size container (container-type) at the next paint, so whoever takes a
 * picture seeks again after one (seekScript in server/exporter.mjs).
 */
import { captionTimeline } from "@/content/timing.mjs";
import type { Scene } from "@/content/showcases";

/** The element SceneView and EmbedSceneView mount afresh for each caption. */
const CAPTION_ELEMENT = ".caption-fade";

/** A scene can be pinned a hair longer than its clip (both are rounded to
 *  frames). Up to two frames over holds the clip's last frame instead of
 *  replaying its first one just before the cut. */
const CLIP_END_SLACK_S = 2 / 30;

type TimedScene = Pick<Scene, "captions" | "durationMs">;

/** When the caption on screen at `elapsedMs` appeared. The caption's
 *  element is keyed by its text, so a repeated line doesn't appear again. */
export function captionShownAtMs(scene: TimedScene, elapsedMs: number): number {
  const timeline = captionTimeline(scene);
  let index = timeline.findIndex((entry) => elapsedMs < entry.endMs);
  if (index < 0) index = timeline.length - 1;
  while (index > 0 && timeline[index - 1]!.text === timeline[index]!.text) index--;
  return timeline[index]?.startMs ?? 0;
}

/** Where a clip is, in seconds, `elapsedMs` into its scene. */
export function clipTimeS({
  elapsedMs,
  sceneMs,
  clipS,
  speed,
}: {
  elapsedMs: number;
  sceneMs: number;
  clipS: number;
  speed: number;
}): number {
  const seconds = (elapsedMs / 1000) * speed;
  if (!clipS) return seconds;
  if (seconds < clipS) return seconds;
  const loops = (sceneMs / 1000) * speed > clipS + CLIP_END_SLACK_S;
  /* A loop holds its last frame for one frame before it first wraps. */
  if (!loops || seconds < clipS + 1 / 30) return clipS;
  return seconds % clipS;
}

/** Pauses every animation and video in `root` at `elapsedMs` into `scene`. */
export function seekSceneMedia(
  root: Pick<Document, "getAnimations" | "querySelectorAll">,
  scene: TimedScene,
  elapsedMs: number,
) {
  const captionAtMs = captionShownAtMs(scene, elapsedMs);
  for (const animation of root.getAnimations()) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    const startMs = target?.closest(CAPTION_ELEMENT) ? captionAtMs : 0;
    animation.pause();
    animation.currentTime = elapsedMs - startMs;
  }
  for (const video of root.querySelectorAll("video")) {
    video.pause();
    const place = () => {
      video.currentTime = clipTimeS({
        elapsedMs,
        sceneMs: scene.durationMs,
        clipS: video.duration,
        /* media.speed: SceneMedia puts it on playbackRate. */
        speed: video.playbackRate || 1,
      });
    };
    /* A jump into a scene mounts its clip, and where a looping clip is
     * can't be known until its length is. */
    if (video.readyState >= 1) place();
    else video.addEventListener("loadedmetadata", place, { once: true });
  }
}
