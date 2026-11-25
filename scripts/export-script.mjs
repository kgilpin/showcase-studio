/* Print a showcase's narration script as plain text.
 *
 * Processes showcases/<id>/showcase.yaml the same way the /script
 * teleprompter does (ScriptPlayer's buildLines): the narration is the
 * caption and support lines. Titles are on-screen text and appear only
 * in slide headers.
 *
 * Usage:
 *   npm run export:script            # every showcase
 *   npm run export:script -- nova    # just the named showcase(s)
 *
 * Reads the YAML directly — no dev server needed. Output goes to stdout;
 * redirect it to a file to share.
 */
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";
import { resolveSceneTiming } from "../src/content/timing.mjs";
import { ciRefusal } from "../server/license.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const showcasesDir = path.join(root, "showcases");
const available = (await readdir(showcasesDir, { withFileTypes: true }))
  /* A showcase is a folder with a showcase.yaml — this skips .studio
   * (the studio generates it in any library it opens) and stray dirs. */
  .filter(
    (entry) =>
      entry.isDirectory() && existsSync(path.join(showcasesDir, entry.name, "showcase.yaml")),
  )
  .map((entry) => entry.name)
  .sort();

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith("--"));
if (flags.length > 0) {
  console.error(`Unknown option "${flags[0]}". export:script only takes showcase ids.`);
  process.exit(1);
}
const unknown = args.filter((id) => !available.includes(id));
if (unknown.length > 0) {
  console.error(`Unknown showcase(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`);
  process.exit(1);
}
const ids = args.length > 0 ? args : available;

/* In CI every export needs a license key (server/license.mjs). */
for (const id of ids) {
  const refused = await ciRefusal("script");
  if (refused) {
    console.error(`${id}: ${refused}`);
    process.exit(1);
  }
}

const secs = (ms) => `${(ms / 1000).toFixed(ms % 1000 ? 1 : 0)}s`;
const oneLine = (s) => s.replace(/\s+/g, " ").trim();

for (const [i, id] of ids.entries()) {
  const doc = parse(await readFile(path.join(showcasesDir, id, "showcase.yaml"), "utf8"));
  const out = [];
  const title = oneLine(doc.meta.title);
  out.push(title.toUpperCase(), "=".repeat(title.length), "");
  if (doc.meta.description) out.push(oneLine(doc.meta.description));

  let total = 0;
  doc.scenes.forEach((scene, index) => {
    const { durationMs } = resolveSceneTiming(scene, doc.meta.pace);
    total += durationMs;
    const header = [`Slide ${index + 1}`];
    if (scene.eyebrow) header.push(scene.eyebrow);
    if (scene.title) header.push(scene.title);
    out.push("", `--- ${header.join(" · ")}  [${secs(durationMs)}]`);
    for (const caption of scene.captions ?? []) out.push(`    ${oneLine(caption.text)}`);
    if (scene.support) out.push(`    ${oneLine(scene.support)}`);
    if (scene.cta) out.push(`    (on-screen button: ${scene.cta.label})`);
  });

  out.push(
    "",
    `Total running time: ~${Math.round(total / 1000)} seconds.`,
    "Indented lines are the narration, read verbatim in order as one continuous voiceover.",
    "Slide titles in headers are on-screen text only and are never read aloud.",
  );
  if (i > 0) console.log("\n");
  console.log(out.join("\n"));
}
