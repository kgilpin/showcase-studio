/* The moment a screenshot shows: where a scene lands when it finishes
 * playing — graphics fully revealed, motion complete — just as the App
 * Screens view looks at the end of the scene. Footage is the exception: a
 * clip's last frame is often a blink or a cut, so it shows its middle.
 *
 *   scene      0 ─────────────── durationMs
 *   footage             ▲ middle
 *   others                            ▲ end (a hair before the cut)
 */
import type { Scene } from "@/content/showcases";

/** How far before the cut the still is taken, so it shows this scene and
 *  not the frame where the next one would begin. */
const BEFORE_CUT_MS = 50;

export function stillMomentMs(scene: Pick<Scene, "theme" | "durationMs">): number {
  if (scene.theme === "footage") return scene.durationMs / 2;
  return Math.max(0, scene.durationMs - BEFORE_CUT_MS);
}
