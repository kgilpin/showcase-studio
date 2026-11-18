/* Renders the app icon: build/icon.svg → build/icon.png (1024×1024, the
 * size electron-builder turns into the .icns), and the YouTube channel
 * picture: build/youtube-avatar.svg → build/youtube-avatar.png (800×800).
 * Run after editing either SVG:
 *   npm run build:icon
 * The SVG follows Apple's macOS icon grid — an 824px rounded square on a
 * 1024px canvas — so the Dock draws it the same size as its neighbours.
 * Drawn with Playwright's Chromium (already installed for exports). */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const images = [
  { name: "icon", size: 1024 },
  { name: "youtube-avatar", size: 800 },
];

const browser = await chromium.launch();
try {
  for (const { name, size } of images) {
    const svgPath = path.join(repoRoot, "build", `${name}.svg`);
    const pngPath = path.join(repoRoot, "build", `${name}.png`);
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block}</style>${readFileSync(svgPath, "utf8")}`,
    );
    await page.screenshot({ path: pngPath, omitBackground: true });
    await page.close();
    console.log(`${name}: ${path.relative(repoRoot, pngPath)}`);
  }
} finally {
  await browser.close();
}
