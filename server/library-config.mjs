/* Library-level settings: a showcase_settings.yaml at the ROOT of a
 * showcases folder. The studio writes one (all comments) into every
 * library it opens, so the file also marks the folder as a library —
 * even before it holds any showcases. The settings:
 *
 *   show_in_recent: false    keep this folder out of File > Open Recent
 *   export_dir: exports      where this library's exports land, instead of
 *                            ~/Downloads/showcase-exports: a folder path,
 *                            relative to the library root or absolute
 *                            (<export_dir>/<showcase id>/ per showcase)
 *   aws_profile: ${USER}     the AWS profile the synthesized voiceovers
 *                            (Polly, voiceover.mjs) are made with, when a
 *                            showcase's own meta.voiceover names none
 *   aws_region: us-east-1    and the region, when the profile has none
 *   say: {GitHub: Git Hub}   how words are said in every synthesized
 *                            voiceover (voiceover-say.mjs); a showcase's
 *                            meta.voiceover.say wins
 *
 * A setting's text may name an environment variable as ${NAME}, which is
 * replaced when the file is read: a committed file can say
 * `aws_profile: ${USER}` for a team whose profiles are named after their
 * login names. A variable that isn't set is reported, not guessed
 * (readLibraryConfig's `problems`); the setting keeps its unexpanded
 * text. Unknown keys are ignored. expandVariables does the replacing.
 * libraryAwsSettings reads the two AWS settings, and leaves out one
 * with a problem: it is never used as written. librarySay reads the
 * say list, leaving out each entry that doesn't read, with a warning.
 *
 * A new setting gets a commented line in SETTINGS_TEMPLATE, which new
 * libraries show, and a description in the authoring guide
 * (server/showcase-guide.md). Existing libraries keep the file they
 * have, so the guide is how their sessions learn about it.
 *
 * Older libraries keep their settings in a root-level showcase.yaml — the
 * same name as each showcase's own <id>/showcase.yaml, one level down.
 * The studio renames it to showcase_settings.yaml when it opens the
 * library (migrateLibrarySettings). Until then it is still read, as long
 * as it has no `scenes` or `meta` (those make it a showcase's script,
 * never settings): Open Recent and findLibrary look at folders
 * no studio has opened since.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { readSay } from "./voiceover-say.mjs";

export const SETTINGS_FILE = "showcase_settings.yaml";
const OLD_SETTINGS_FILE = "showcase.yaml";

/** The parsed YAML mapping in `file`, or undefined when the file is
 *  missing, unparsable, or not a mapping. */
function readMapping(file) {
  try {
    const parsed = parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The old-style settings in `dir`/showcase.yaml: a mapping with no
 *  `scenes` or `meta`. Undefined for a showcase's script — even one still
 *  being written — or anything unreadable. */
function oldSettings(dir) {
  const parsed = readMapping(path.join(dir, OLD_SETTINGS_FILE));
  return parsed && !("scenes" in parsed) && !("meta" in parsed) ? parsed : undefined;
}

/** True when `dir` has library settings: a showcase_settings.yaml, or an
 *  old-style root showcase.yaml with no scenes. Such a folder is a
 *  library, not a showcase. */
export function hasLibrarySettings(dir) {
  return existsSync(path.join(dir, SETTINGS_FILE)) || oldSettings(dir) !== undefined;
}

/** True when `dir` is one showcase: its showcase.yaml is a script, not an
 *  older library's settings. A real script wins over library files left
 *  beside it, so a showcase stays a showcase. */
export function isShowcaseFolder(dir) {
  return existsSync(path.join(dir, OLD_SETTINGS_FILE)) && oldSettings(dir) === undefined;
}

/** Why `dir` can't be a library, in words for the user, or undefined
 *  when it can. A library never sits inside another one:
 *
 *    dir is one showcase                    → no: open the folder it's in
 *    a folder above dir has library settings → no: open that folder
 *
 *  Making `dir` a library writes library files into it (settings, README,
 *  .studio/), so this is checked before any studio uses a folder. */
export function libraryProblem(dir) {
  if (isShowcaseFolder(dir)) {
    return `${dir} is a showcase, not a showcases folder. Open the folder it's in, ${path.dirname(dir)}, or open just this showcase.`;
  }
  for (let up = path.dirname(dir); up !== path.dirname(up); up = path.dirname(up)) {
    if (hasLibrarySettings(up)) {
      return `${dir} is inside the showcases folder ${up}, and a showcases folder can't hold another one. Open ${up} instead.`;
    }
  }
  return undefined;
}

/** Renames an older library's root showcase.yaml to
 *  showcase_settings.yaml. Only when it is settings (no `scenes` or `meta`) and
 *  showcase_settings.yaml isn't there yet. Returns true when it moved. */
export function migrateLibrarySettings(dir) {
  if (existsSync(path.join(dir, SETTINGS_FILE)) || oldSettings(dir) === undefined) return false;
  renameSync(path.join(dir, OLD_SETTINGS_FILE), path.join(dir, SETTINGS_FILE));
  return true;
}

/** What a new library's showcase_settings.yaml says: nothing set yet. */
export const SETTINGS_TEMPLATE = `# Showcase Studio library settings.
#
# This file marks this folder as a library of showcases: each showcase is
# a folder beside it, with its own showcase.yaml. Settings go below;
# remove the # to turn one on.
#
# show_in_recent: false   # keep this folder out of File > Open Recent
# export_dir: exports      # put exports in this folder (relative to the
#                          # library, or absolute) instead of ~/Downloads
# aws_profile: \${USER}     # the AWS profile that makes the synthesized
#                          # voiceovers (Polly). \${NAME} is an environment
#                          # variable: \${USER} is the login name.
# aws_region: us-east-1    # the region, when the profile has none set
# say:                     # how words are said in every synthesized
#   GitHub: Git Hub        # voiceover; the captions keep their spelling
`;

/** Gives the library its settings file: renames an older root
 *  showcase.yaml, or writes the commented template when there is none. */
export function ensureLibrarySettings(dir) {
  if (migrateLibrarySettings(dir) || existsSync(path.join(dir, SETTINGS_FILE))) return;
  writeFileSync(path.join(dir, SETTINGS_FILE), SETTINGS_TEMPLATE);
}

/** `text` with every ${NAME} replaced by that environment variable;
 *  `missing` names the variables that aren't set (their ${NAME} is left
 *  as written). */
export function expandVariables(text, env = process.env) {
  const missing = [];
  const value = text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
    if (env[name] == null) {
      missing.push(name);
      return whole;
    }
    return env[name];
  });
  return { value, missing };
}

/** The folder's library settings with their variables expanded, and a
 *  problem sentence for each setting that names a variable that isn't
 *  set: `{settings, problems}`. `settings` is {} when there is nothing to
 *  read or the file is unparsable or not a mapping. */
export function readLibraryConfig(dir, env = process.env) {
  const raw = existsSync(path.join(dir, SETTINGS_FILE))
    ? readMapping(path.join(dir, SETTINGS_FILE))
    : oldSettings(dir);
  const settings = {};
  const problems = [];
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (typeof value !== "string") {
      settings[key] = value;
      continue;
    }
    const { value: expanded, missing } = expandVariables(value, env);
    settings[key] = expanded;
    if (missing.length > 0) {
      problems.push(
        `${SETTINGS_FILE} ${key}: ${value} — ${missing.join(", ")} ` +
          `${missing.length === 1 ? "isn't" : "aren't"} set in the environment`,
      );
    }
  }
  return { settings, problems };
}

/** The folder's library settings, {} when there are none or the file is
 *  unparsable or not a mapping. */
export function libraryConfig(dir) {
  return readLibraryConfig(dir).settings;
}

/** The AWS profile and region the library's voiceovers are made with
 *  (aws_profile, aws_region), each undefined when unset; `problem` when
 *  one names a variable that isn't set or isn't text. */
export function libraryAwsSettings(dir, env = process.env) {
  const { settings, problems } = readLibraryConfig(dir, env);
  const result = {};
  const wrong = [];
  for (const [key, name] of [
    ["aws_profile", "profile"],
    ["aws_region", "region"],
  ]) {
    const value = settings[key];
    if (value == null) continue;
    /* A variable that isn't set: reported below, never used as written. */
    if (problems.some((line) => line.startsWith(`${SETTINGS_FILE} ${key}:`))) continue;
    if (typeof value !== "string" || !value.trim()) {
      wrong.push(`${SETTINGS_FILE} ${key} must be text`);
      continue;
    }
    result[name] = value.trim();
  }
  const about = problems.filter((line) => /^\S+ aws_(profile|region):/.test(line));
  const all = [...wrong, ...about];
  return all.length > 0 ? { ...result, problem: all.join("\n") } : result;
}

/** The library's say list (how words are said in its synthesized
 *  voiceovers): `{entries, warnings}`, see readSay. */
export function librarySay(dir) {
  return readSay(libraryConfig(dir).say, `${SETTINGS_FILE} say`);
}

/** False only when the folder's settings say show_in_recent: false. */
export function showInRecent(dir) {
  return libraryConfig(dir).show_in_recent !== false;
}

/** The folder the library's exports go in, absolute, when its settings
 *  name one (export_dir, relative to the library root or absolute);
 *  undefined to use the studio's default. */
export function libraryExportDir(dir) {
  const value = libraryConfig(dir).export_dir;
  if (typeof value !== "string" || !value.trim()) return undefined;
  return path.resolve(dir, value.trim());
}
