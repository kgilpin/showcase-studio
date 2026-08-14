/* Export App Store screenshots from the showcases.
 *
 * For each showcase in src/showcases/, opens /showcase/<id>/export/<scene-id>
 * for every scene that doesn't set `export: false`, and screenshots each one
 * at a 440x956 viewport with deviceScaleFactor 3 — producing 1320x2868 PNGs,
 * the App Store 6.9" screenshot size. Output goes to exports/<id>/.
 *
 * Screens use the App Screens presentation: the slide title carries the
 * message and captions stay off (captions belong to the video export,
 * where they narrate over the media).
 *
 * Usage:
 *   npm run dev                       # in one terminal (or any server on BASE_URL)
 *   npm run export:screens            # in another — exports every showcase
 *   npm run export:screens -- nova    # or just the named showcase(s)
 *
 * Env: BASE_URL (default http://localhost:8080), OUT_DIR (default exports).
 */
import { readFile, readdir, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const baseUrl = process.env.BASE_URL ?? "http://localhost:8080";
const outRoot = path.resolve(root, process.env.OUT_DIR ?? "exports");

const showcasesDir = path.join(root, "src/showcases");
const available = (await readdir(showcasesDir, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

const args = process.argv.slice(2);
const flags = args.filter((arg) => arg.startsWith("--"));
const requested = args.filter((arg) => !arg.startsWith("--"));

if (flags.length > 0) {
  console.error(`Unknown option "${flags[0]}". export:screens only takes showcase ids.`);
  process.exit(1);
}

const unknown = requested.filter((id) => !available.includes(id));
if (unknown.length > 0) {
  console.error(`Unknown showcase(s): ${unknown.join(", ")}. Available: ${available.join(", ")}`);
  process.exit(1);
}
const ids = requested.length > 0 ? requested : available;

// Fail fast with a clear message if the dev server isn't running.
try {
  await fetch(baseUrl, { signal: AbortSignal.timeout(5000) });
} catch {
  console.error(`Cannot reach ${baseUrl} — start the app first with: npm run dev`);
  process.exit(1);
}

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 440, height: 956 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();

for (const id of ids) {
  const yamlPath = path.join(showcasesDir, id, "showcase.yaml");
  const doc = parse(await readFile(yamlPath, "utf8"));
  const scenes = doc.scenes.filter((scene) => scene.export !== false);
  const skipped = doc.scenes.length - scenes.length;
  const outDir = path.join(outRoot, id);
  await mkdir(outDir, { recursive: true });

  console.log(
    `Exporting ${id}: ${scenes.length} scenes (${skipped} marked export: false) to ${outDir}`,
  );

  for (const [i, scene] of scenes.entries()) {
    const name = `${String(i + 1).padStart(2, "0")}-${scene.id}.png`;
    await page.goto(`${baseUrl}/showcase/${id}/export/${scene.id}`, {
      waitUntil: "networkidle",
    });
    // Make sure fonts and images have fully rendered before capturing.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((img) => img.decode().catch(() => undefined)),
      );
    });
    await page.screenshot({ path: path.join(outDir, name) });
    console.log(`  ${name}`);
  }
}

await browser.close();
console.log("Done.");
