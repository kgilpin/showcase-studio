/* Video templates: what kind of video a new showcase is. Claude asks the
 * user to pick one (or "other") before it writes a showcase, and
 * create_showcase starts the showcase from it.
 *
 * A template is one YAML file holding settings and guidance together:
 *
 *   name: Feature explainer          what the user picks from
 *   description: One line.           what it is for, in the list
 *   meta:                            copied into the new showcase's meta
 *     targetMs: 45000                  (only the keys in TEMPLATE_META;
 *     sceneMaxMs: 8000                 the shipped ones leave view out:
 *                                      where a video goes is asked, not
 *                                      part of what kind of video it is)
 *   guidance: |                      what this kind of video is for and
 *     ...                            what each scene should do; Claude
 *                                    follows it while writing
 *   titles:                          a few good and bad titles
 *     good: [...]
 *     bad: [...]
 *   titleCheck: story                what check_titles asks its reader
 *                                    (TITLE_CHECKS; screen when unset)
 *   scenes:                          the starting scenes, written into
 *     - id: hook                     showcase.yaml as they are; a scene
 *       theme: statement             with no media gets `kind: none`
 *       title: ...
 *       note: What this scene does.
 *       captions: [{text: ...}]
 *
 * Where templates come from:
 *
 *   server/templates/<id>.yaml              shipped with the studio, so
 *                                           they update with the app
 *   <library>/showcase_templates/<id>.yaml  added by a library, kept in
 *                                           its git; one with the same id
 *                                           as a shipped one replaces it
 *
 * The id is the file name without .yaml. A template with a problem is
 * left out and its problem reported, like a theme problem: never an
 * error that stops the list. There is no remote source on purpose: the
 * guidance becomes instructions Claude follows, so it only comes from
 * files that are reviewed (the app's own, or the library's git).
 *
 * A "template" here is not a slide layout: a scene's `theme:` keeps its
 * meaning. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { PLAYER_VIEWS, playerView } from "../src/lib/export-kinds.mjs";

export const SHIPPED_TEMPLATES_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
);
/** The folder beside showcase_settings.yaml where a library keeps its own. */
export const LIBRARY_TEMPLATES_DIR = "showcase_templates";
/** The answer for "none of these": no starting scenes, one question. */
export const OTHER_TEMPLATE = "other";

/** The meta keys a template may set, with a check for each value. */
const TEMPLATE_META = {
  targetMs: (v) => Number.isFinite(v) && v > 0,
  sceneMaxMs: (v) => Number.isFinite(v) && v > 0,
  view: (v) => PLAYER_VIEWS.includes(v),
};

const ID = /^[a-z0-9][a-z0-9-]*$/;

/** What check_titles asks its reader, set by a template's titleCheck:
 *    screen  "what does each slide show?" (titles say what is on screen)
 *    story   "retell what happened" (titles are claims that tell a story) */
export const TITLE_CHECKS = ["screen", "story"];

/** One template file read and checked: {template} or {problem}. */
function readTemplate(file, id, source) {
  const where = source === "library" ? `${LIBRARY_TEMPLATES_DIR}/${id}.yaml` : `${id}.yaml`;
  let raw;
  try {
    raw = parse(readFileSync(file, "utf8"));
  } catch (error) {
    return { problem: `${where}: not valid YAML (${error.message.split("\n")[0]})` };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { problem: `${where}: must be a mapping` };
  }
  if (id === OTHER_TEMPLATE) return { problem: `${where}: "other" is taken; rename the file` };
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    return { problem: `${where}: needs a name` };
  }
  const meta = {};
  for (const [key, value] of Object.entries(raw.meta ?? {})) {
    if (!(key in TEMPLATE_META)) {
      return {
        problem: `${where}: meta.${key} can't be set by a template (only ${Object.keys(TEMPLATE_META).join(", ")})`,
      };
    }
    if (!TEMPLATE_META[key](value)) return { problem: `${where}: meta.${key} is not valid` };
    meta[key] = value;
  }
  const scenes = raw.scenes ?? [];
  if (!Array.isArray(scenes)) return { problem: `${where}: scenes must be a list` };
  const ids = new Set();
  for (const [index, scene] of scenes.entries()) {
    if (!scene || typeof scene !== "object" || typeof scene.id !== "string" || !scene.id) {
      return { problem: `${where}: scene ${index + 1} needs an id` };
    }
    if (ids.has(scene.id)) return { problem: `${where}: two scenes are named ${scene.id}` };
    ids.add(scene.id);
  }
  if (raw.titleCheck !== undefined && !TITLE_CHECKS.includes(raw.titleCheck)) {
    return { problem: `${where}: titleCheck must be ${TITLE_CHECKS.join(" or ")}` };
  }
  const list = (value) => (Array.isArray(value) ? value.map(String) : []);
  return {
    template: {
      id,
      source,
      name: raw.name.trim(),
      description: typeof raw.description === "string" ? raw.description.trim() : "",
      meta,
      guidance: typeof raw.guidance === "string" ? raw.guidance.trim() : "",
      titles: { good: list(raw.titles?.good), bad: list(raw.titles?.bad) },
      titleCheck: raw.titleCheck ?? "screen",
      scenes,
    },
  };
}

/** The templates in one folder, read in file-name order. */
function readFolder(dir, source, problems) {
  if (!existsSync(dir)) return [];
  const found = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".yaml")) continue;
    const id = file.slice(0, -".yaml".length);
    if (!ID.test(id)) {
      problems.push(
        `${source === "library" ? `${LIBRARY_TEMPLATES_DIR}/` : ""}${file}: ` +
          "the file name must be lower case letters, digits and dashes",
      );
      continue;
    }
    const { template, problem } = readTemplate(path.join(dir, file), id, source);
    if (problem) problems.push(problem);
    else found.push(template);
  }
  return found;
}

/** Every template this library can use: the shipped ones, then the
 *  library's own (a library template replaces a shipped one with the same
 *  id, in its place). `{templates, problems}`. */
export function listTemplates(libraryDir, { shippedDir = SHIPPED_TEMPLATES_DIR } = {}) {
  const problems = [];
  const byId = new Map();
  for (const template of readFolder(shippedDir, "studio", problems)) {
    byId.set(template.id, template);
  }
  if (libraryDir) {
    for (const template of readFolder(
      path.join(libraryDir, LIBRARY_TEMPLATES_DIR),
      "library",
      problems,
    )) {
      byId.set(template.id, template);
    }
  }
  return { templates: [...byId.values()], problems };
}

/** One template by id, or undefined. */
export function findTemplate(libraryDir, id, options) {
  return listTemplates(libraryDir, options).templates.find((t) => t.id === id);
}

/** A template as the list shows it: enough to choose from. */
export function templateSummary(template) {
  return {
    id: template.id,
    name: template.name,
    description: template.description,
    source: template.source,
    ...template.meta,
    scenes: template.scenes.map((scene) => scene.id),
  };
}

/** Which player view the library's showcases open in: how many use each
 *  (`counts`), and the most used (`suggested`, undefined when none sets
 *  one). A template says what kind of video it is, not where it goes, so
 *  Claude asks the user where a new one goes and offers this as the
 *  likely answer. */
export function libraryViews(libraryDir) {
  const counts = {};
  if (!libraryDir || !existsSync(libraryDir)) return { counts };
  for (const entry of readdirSync(libraryDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(libraryDir, entry.name, "showcase.yaml");
    if (!existsSync(file)) continue;
    let view;
    try {
      view = playerView(parse(readFileSync(file, "utf8"))?.meta?.view);
    } catch {
      continue;
    }
    if (view) counts[view] = (counts[view] ?? 0) + 1;
  }
  const suggested = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return suggested ? { counts, suggested } : { counts };
}

/** What Claude follows while writing a showcase made from the template. */
export function templateGuidance(template) {
  return {
    id: template.id,
    name: template.name,
    guidance: template.guidance,
    titles: template.titles,
    titleCheck: template.titleCheck,
  };
}

/** The starter showcase.yaml for a new showcase.
 *  - no template: the + card's one-scene starter
 *  - "other": the same, with the user's answer to "what is this video
 *    for?" in meta.notes
 *  - a template: its meta settings, meta.template naming it, and its
 *    starting scenes
 *  `view` is where the user said the video goes (one of PLAYER_VIEWS);
 *  it wins over a library template's own meta.view. */
export function starterShowcaseYaml(title, { template, purpose, view } = {}) {
  const meta = {
    title,
    description: `Describe ${title} in a sentence.`,
    loop: true,
  };
  const intro = {
    id: "intro",
    theme: "statement",
    title,
    captions: [{ text: "Replace this narration with your opening line." }],
    media: { kind: "none" },
  };
  let scenes = [intro];
  if (template) {
    Object.assign(meta, template.meta, { template: template.id });
    if (template.scenes.length > 0) {
      scenes = template.scenes.map((scene) => ({
        ...scene,
        media: scene.media ?? { kind: "none" },
      }));
    }
  }
  const chosen = playerView(view);
  if (chosen) meta.view = chosen;
  const why = String(purpose ?? "").trim();
  if (why) meta.notes = `What this video is for: ${why}`;
  return stringify({ meta, scenes }, { lineWidth: 0 }).replace(/\nscenes:/, "\n\nscenes:");
}
