/* The desktop window's extras. Everything the studio does goes through
 * the studio server over HTTP (src/lib/studio.ts), exactly as in a
 * browser; the window only adds what a browser can't do — the real path
 * of a file dropped onto the terminal, and dragging an exported video
 * out of the Share page onto an upload page in the browser (the main
 * process checks the file is an export: electron/main.mjs). The page
 * reaches them as window.showcaseStudioShell.pathForFile and startDrag;
 * main.mjs only drags an .mp4 inside the export folder. */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("showcaseStudioShell", {
  pathForFile: (file) => webUtils.getPathForFile(file),
  startDrag: (file) => ipcRenderer.send("studio:start-drag", String(file)),
});
