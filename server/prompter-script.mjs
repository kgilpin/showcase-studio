/* The prompter script snapshot: the small, self-contained JSON a shared
 * teleprompter needs — the narration lines and resolved timings, nothing
 * else. No YAML, no theme, no assets travel: the phone page (web/prompter)
 * renders ScriptPlayer straight from this document.
 *
 * Published as scripts/<token>.json on the prompter site (cdk/), where
 * the token is an unguessable capability — anyone with the URL can read
 * the script, nobody can list tokens. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";

/** Derives the snapshot from showcase.yaml text. Captions keep explicit
 *  durations where authored (budget mode splits the rest at render time,
 *  same as the app); everything display-only (titles, media, themes)
 *  stays home. */
export function prompterScriptFromYaml(yamlText, showcaseId, { publishedAt } = {}) {
  const doc = parse(yamlText);
  const scenes = (doc.scenes ?? []).map((scene) => {
    const timing = resolveSceneTiming(scene, doc.meta?.pace);
    return {
      id: scene.id,
      ...(scene.eyebrow ? { eyebrow: scene.eyebrow } : {}),
      durationMs: timing.durationMs,
      captions: timing.captions.map((caption) => ({
        text: caption.text,
        ...(caption.durationMs != null ? { durationMs: caption.durationMs } : {}),
      })),
      ...(scene.support ? { support: scene.support } : {}),
    };
  });
  return {
    version: 1,
    id: showcaseId,
    title: doc.meta?.title ?? showcaseId,
    ...(publishedAt ? { publishedAt } : {}),
    scenes,
  };
}

/** The snapshot for one showcase folder. */
export function prompterScript(showcasesDir, showcaseId, options = {}) {
  const yamlText = readFileSync(path.join(showcasesDir, showcaseId, "showcase.yaml"), "utf8");
  return prompterScriptFromYaml(yamlText, showcaseId, options);
}
