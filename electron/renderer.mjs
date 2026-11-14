/* The packaged app's page renderer: hidden offscreen Electron windows, so
 * screenshots and exports need no extra browser. Same interface as
 * server/renderer-playwright.mjs, which the dev modes use.
 *
 * A capture must be exactly the target size. The window is the target size
 * in points and draws one pixel per point (offscreen.deviceScaleFactor: 1),
 * the same as the dev renderer's deviceScaleFactor: 1. Since Electron 42 an
 * offscreen window draws at 1 by default, whatever the display's scale;
 * sizing the window for the display's scale halved every export on a
 * Retina Mac (issue #22). It is set here so a later default can't move it.
 * server/exporter.mjs checks every capture's size. */
import { BrowserWindow } from "electron";
import { withTimeLimit } from "../server/time-limit.mjs";

/* A capture that never answers would hang an export forever. */
const CAPTURE_TIMEOUT_MS = 30_000;

export function createElectronRenderer() {
  return {
    async openPage({ width, height }) {
      const win = new BrowserWindow({
        show: false,
        width,
        height,
        useContentSize: true,
        frame: false,
        enableLargerThanScreen: true,
        webPreferences: { offscreen: { deviceScaleFactor: 1 } },
      });
      win.webContents.setFrameRate(60);
      const capture = () =>
        withTimeLimit(
          win.webContents.capturePage(),
          CAPTURE_TIMEOUT_MS,
          `The page renderer did not capture the page within ${CAPTURE_TIMEOUT_MS / 1000} s`,
        );
      return {
        goto: (url) => win.loadURL(url),
        evaluate: (script) => win.webContents.executeJavaScript(script),
        capture: async ({ format = "png" } = {}) => {
          const image = await capture();
          return format === "jpeg" ? image.toJPEG(90) : image.toPNG();
        },
        close: async () => {
          if (!win.isDestroyed()) win.destroy();
        },
      };
    },
    async dispose() {},
  };
}
