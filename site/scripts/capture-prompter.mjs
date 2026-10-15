#!/usr/bin/env node
/**
 * Captures the teleprompter picture for the "Step in front of the camera"
 * section: the nova script on a phone-sized screen, on the jump gate line.
 * Writes media-src/nova-prompter.png; npm run media turns it into
 * public/media/prompter.webp.
 *
 *   (repo root)  PORT=8123 npm run dev -- --no-terminal --no-auto-commit --alongside
 *   (site/)      npm run capture:prompter      (STUDIO=<url> for another address)
 *
 * Uses the repo root's Playwright (npm i at the root).
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(site, "..", "package.json"));
const { chromium } = require("playwright");

const studio = process.env.STUDIO ?? "http://localhost:8123";
// Lines to skip from the start of the script to reach the jump gate line.
const LINES_BEFORE_JUMP_GATES = 8;

const browser = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
const page = await browser.newPage({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2 });
await page.goto(`${studio}/showcase/nova/script?record=1`, { waitUntil: "networkidle" });
const next = page.getByRole("button", { name: "Jump to the next line" });
for (let i = 0; i < LINES_BEFORE_JUMP_GATES; i++) {
  await next.click();
  await page.waitForTimeout(400);
}
await page.waitForTimeout(1200);
const out = path.join(site, "media-src", "nova-prompter.png");
await page.screenshot({ path: out });
await browser.close();
console.log(`saved ${out}`);
