/* Draws the studio's pages for screenshots and exports with Playwright,
 * in any Node process — the dev modes use it. The packaged app passes
 * Electron's renderer instead (electron/renderer.mjs). Both offer the
 * same small interface, which server/exporter.mjs uses:
 *
 *   openPage({ width, height }) → { goto(url), evaluate(script), capture(options), close() }
 *   dispose()
 *
 * `evaluate` runs a script string in the page (an async IIFE is awaited)
 * and returns its value; `capture` returns a PNG Buffer of exactly
 * width × height (`capture({ format: "jpeg" })`: a JPEG, at quality 90).
 *
 * The browser starts on first use and stays up. Its pages share one
 * browser context, so after the first capture the app's modules come from
 * the cache — from source, the dev server serves hundreds of them, and a
 * fresh context per page reloaded them all every time. The browser is
 * Google Chrome when installed: Playwright's own Chromium can't play MP4
 * (H.264) video, so slides with video clips would capture blank. Without
 * Chrome it falls back to that Chromium (first time: `npx playwright
 * install chromium`). */
export function createPlaywrightRenderer({ log = (message) => console.log(message) } = {}) {
  let contextPromise;
  let browser;

  const context = () => {
    contextPromise ??= (async () => {
      const { chromium } = await import("playwright");
      try {
        browser = await chromium.launch({ channel: "chrome" });
      } catch {
        log(
          "studio: Google Chrome not found — rendering with Playwright's Chromium, " +
            "which can't play MP4 video (video clips capture blank)",
        );
        browser = await chromium.launch();
      }
      return browser.newContext({ deviceScaleFactor: 1 });
    })().catch((error) => {
      contextPromise = undefined;
      throw new Error(
        `The page renderer could not start: ${String(error?.message ?? error).split("\n")[0]}. ` +
          "Install Google Chrome, or run `npx playwright install chromium` once.",
      );
    });
    return contextPromise;
  };

  return {
    async openPage({ width, height }) {
      const page = await (await context()).newPage();
      await page.setViewportSize({ width, height });
      return {
        goto: async (url) => {
          await page.goto(url, { waitUntil: "load" });
        },
        evaluate: (script) => page.evaluate(script),
        capture: ({ format = "png" } = {}) =>
          page.screenshot(format === "jpeg" ? { type: "jpeg", quality: 90 } : { type: "png" }),
        close: () => page.close(),
      };
    },
    async dispose() {
      const current = contextPromise;
      contextPromise = undefined;
      await (await current?.catch(() => undefined))?.close();
      await browser?.close();
      browser = undefined;
    },
  };
}
