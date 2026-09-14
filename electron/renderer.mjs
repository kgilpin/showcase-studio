/* The packaged app's page renderer: hidden offscreen Electron windows, so
 * screenshots and exports need no extra browser. Same interface as
 * server/renderer-playwright.mjs, which the dev modes use.
 *
 * Offscreen windows render at the primary display's scale factor, so each
 * window is sized to target ÷ scale and captures land at exactly the
 * target size; the stage's container-query typography keeps the layout
 * identical at any resolution. */
import { BrowserWindow, screen } from "electron";

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
      return {
        goto: async (url) => {
          await win.loadURL(url);
        },
        evaluate: (script) => win.webContents.executeJavaScript(script),
        capture: async () => (await win.webContents.capturePage()).toPNG(),
        close: async () => {
          if (!win.isDestroyed()) win.destroy();
        },
      };
    },
    async dispose() {},
  };
}
