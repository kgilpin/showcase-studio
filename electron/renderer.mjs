/* The packaged app's page renderer: hidden offscreen Electron windows, so
 * screenshots and exports need no extra browser. Same interface as
 * server/renderer-playwright.mjs, which the dev modes use.
 *
 * A capture must be exactly the target size, but how many pixels an
 * offscreen window draws per window point isn't something to assume: on a
 * Retina main display it has drawn at 1× while the window was sized for
 * 2×, which halved every export (issue #22). So the window opens at
 * target ÷ the display's scale, and after the first page loads it is
 * captured once and resized by the ratio until the capture is the target
 * size. The stage's container-query typography keeps the layout identical
 * at any resolution. server/exporter.mjs checks every capture's size. */
import { BrowserWindow, screen } from "electron";

/** Lets the page lay out and paint after a resize. */
const NEXT_PAINT = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))`;

export function createElectronRenderer() {
  return {
    async openPage({ width, height }) {
      const scale = screen.getPrimaryDisplay().scaleFactor || 1;
      const win = new BrowserWindow({
        show: false,
        width: Math.round(width / scale),
        height: Math.round(height / scale),
        frame: false,
        enableLargerThanScreen: true,
        webPreferences: { offscreen: true },
      });
      win.webContents.setFrameRate(60);
      const captureImage = () => win.webContents.capturePage();
      let measured = false;
      /* Two tries: the second corrects any rounding left by the first. */
      const fitToTarget = async () => {
        await win.webContents.executeJavaScript(NEXT_PAINT);
        for (let attempt = 0; attempt < 2; attempt++) {
          const got = (await captureImage()).getSize();
          if (got.width === width && got.height === height) return;
          if (!got.width || !got.height) return;
          const [w, h] = win.getContentSize();
          win.setContentSize(
            Math.round((w * width) / got.width),
            Math.round((h * height) / got.height),
          );
          await win.webContents.executeJavaScript(NEXT_PAINT);
        }
      };
      return {
        goto: async (url) => {
          await win.loadURL(url);
          if (!measured) {
            measured = true;
            await fitToTarget();
          }
        },
        evaluate: (script) => win.webContents.executeJavaScript(script),
        capture: async () => (await captureImage()).toPNG(),
        close: async () => {
          if (!win.isDestroyed()) win.destroy();
        },
      };
    },
    async dispose() {},
  };
}
