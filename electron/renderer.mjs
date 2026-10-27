/* The packaged app's page renderer: hidden offscreen Electron windows, so
 * screenshots and exports need no extra browser. Same interface as
 * server/renderer-playwright.mjs, which the dev modes use.
 *
 * A capture must be exactly the target size, but how many pixels an
 * offscreen window draws per window point isn't something to assume: on a
 * Retina main display it has drawn at 1× while the window was sized for
 * 2×, which halved every export (issue #22). So the window opens at
 * target ÷ the display's scale, shows a blank page, and is captured once
 * and resized by the ratio until the capture is the target size. Only then
 * does it load a showcase page: capturing and resizing a page that is
 * starting video failed in Chromium's compositor ("UnknownVizError") or
 * never answered. The stage's container-query typography keeps the layout
 * identical at any resolution. server/exporter.mjs checks every capture's
 * size. */
import { BrowserWindow, screen } from "electron";
import { fitToTarget, withTimeLimit } from "../server/fit-capture.mjs";

/** Lets the page lay out and paint after a resize. */
const NEXT_PAINT = `new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))`;

/** A plain white page to measure on: no media, nothing loading. */
const BLANK_PAGE = `data:text/html,${encodeURIComponent(
  "<!doctype html><html><body style='margin:0;background:#fff'></body></html>",
)}`;

/* A capture that never answers would hang an export forever. */
const CAPTURE_TIMEOUT_MS = 30_000;

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
      const captureImage = () =>
        withTimeLimit(
          win.webContents.capturePage(),
          CAPTURE_TIMEOUT_MS,
          `The page renderer did not capture the page within ${CAPTURE_TIMEOUT_MS / 1000} s`,
        );
      try {
        await win.loadURL(BLANK_PAGE);
        await fitToTarget({
          width,
          height,
          capture: async () => (await captureImage()).getSize(),
          getSize: () => win.getContentSize(),
          setSize: (w, h) => win.setContentSize(w, h),
          paint: () => win.webContents.executeJavaScript(NEXT_PAINT),
        });
      } catch (error) {
        win.destroy();
        throw error;
      }
      return {
        goto: (url) => win.loadURL(url),
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
