// Checks that Playwright's own Chromium, for the installed Playwright
// version, is downloaded. Exports fall back to it when Google Chrome is missing.
import { existsSync } from "node:fs";
import { chromium } from "playwright";

const browser = chromium.executablePath();
if (!existsSync(browser)) {
  console.error(`No Playwright Chromium at ${browser}`);
  process.exit(1);
}
