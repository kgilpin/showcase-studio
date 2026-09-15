/* Renders the app icon: build/icon.svg → build/icon.png (1024×1024, the
 * size electron-builder turns into the .icns). Run after editing the SVG:
 *   npm run build:icon
 * The SVG follows Apple's macOS icon grid — an 824px rounded square on a
 * 1024px canvas — so the Dock draws it the same size as its neighbours.
 * Drawn with Playwright's Chromium (already installed for exports). */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svgPath = path.join(repoRoot, "build", "icon.svg");
const pngPath = path.join(repoRoot, "build", "icon.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 1024 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${readFileSync(svgPath, "utf8")}`,
  );
  await page.screenshot({ path: pngPath, omitBackground: true });
  console.log(`icon: ${path.relative(repoRoot, pngPath)}`);
} finally {
  await browser.close();
}
