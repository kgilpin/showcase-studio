/* validate's check that every caption a graphic times itself to exists.
 *
 * It reads the graphics' source, which the page doesn't have (it gets
 * them compiled), so it runs here and not in the loader.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { missingCaptionStarts } from "../src/content/caption-starts-rules.mjs";

/** [{showcaseId, sceneId, message}] for one showcase. A showcase.yaml
 *  that doesn't parse has none: validate reports that as its error. */
export function graphicTimingWarnings(showcasesDir, showcaseId) {
  const folder = path.join(showcasesDir, showcaseId);
  let doc;
  try {
    doc = parse(readFileSync(path.join(folder, "showcase.yaml"), "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(doc?.scenes)) return [];
  return doc.scenes.flatMap((scene) => {
    const media = scene?.media;
    const key = media?.kind === "graphic" ? media.graphic : media?.overlay;
    if (typeof key !== "string" || path.basename(key) !== key) return [];
    const file = [".tsx", ".jsx"]
      .map((extension) => path.join(folder, "graphics", key + extension))
      .find((candidate) => existsSync(candidate));
    if (!file) return [];
    return missingCaptionStarts({
      graphic: key,
      source: readFileSync(file, "utf8"),
      captions: Array.isArray(scene.captions) ? scene.captions : [],
    }).map((message) => ({ showcaseId, sceneId: scene.id, message }));
  });
}
