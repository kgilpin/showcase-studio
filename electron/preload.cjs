/* The desktop window's one extra. Everything the studio does goes through
 * the studio server over HTTP (src/lib/studio.ts), exactly as in a
 * browser; the window only adds what a browser can't do — the real path
 * of a file dropped onto the terminal. */
const { contextBridge, webUtils } = require("electron");

contextBridge.exposeInMainWorld("showcaseStudioShell", {
  pathForFile: (file) => webUtils.getPathForFile(file),
});
