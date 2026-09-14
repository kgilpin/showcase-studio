/* Draws the studio's pages for screenshots and exports with Playwright,
 * in any Node process — the dev modes use it. The packaged app passes
 * Electron's renderer instead (electron/renderer.mjs). Both offer the
 * same small interface, which server/exporter.mjs uses:
 *
 *   openPage({ width, height }) → { goto(url), evaluate(script), capture(), close() }
 *   dispose()
 *
 * `evaluate` runs a script string in the page (an async IIFE is awaited)
 * and returns its value; `capture` returns a PNG Buffer of exactly
 * width × height.
 *
 * The browser starts on first use and stays up for later pages. It is
 * Google Chrome when installed: Playwright's own Chromium can't play MP4
 * (H.264) video, so slides with video clips would capture blank. Without
 * Chrome it falls back to that Chromium (first time: `npx playwright
 * install chromium`). */
export function createPlaywrightRenderer({ log = (message) => console.log(message) } = {}) {
  let browserPromise;

  const browser = () => {
    browserPromise ??= (async () => {
      const { chromium } = await import("playwright");
      try {
        return await chromium.launch({ channel: "chrome" });
      } catch {
        log(
          "studio: Google Chrome not found — rendering with Playwright's Chromium, " +
            "which can't play MP4 video (video clips capture blank)",
        );
        return chromium.launch();
      }
    })().catch((error) => {
      browserPromise = undefined;
      throw new Error(
        `The page renderer could not start: ${String(error?.message ?? error).split("\n")[0]}. ` +
          "Install Google Chrome, or run `npx playwright install chromium` once.",
      );
    });
    return browserPromise;
  };

  return {
    async openPage({ width, height }) {
      const context = await (
        await browser()
      ).newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
      const page = await context.newPage();
      return {
        goto: async (url) => {
          await page.goto(url, { waitUntil: "load" });
        },
        evaluate: (script) => page.evaluate(script),
        capture: () => page.screenshot({ type: "png" }),
        close: () => context.close(),
      };
    },
    async dispose() {
      const current = browserPromise;
      browserPromise = undefined;
      const instance = await current?.catch(() => undefined);
      await instance?.close();
    },
  };
}
