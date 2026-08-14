/* Sandboxed bridge between the studio UI and the shell. The renderer
 * stays a plain web app; inside Electron it additionally sees
 * window.showcaseStudio (typed in src/lib/studio.ts). */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("showcaseStudio", {
  exportScreens: (showcaseId) => ipcRenderer.invoke("export-screens", showcaseId),
  exportVideo: (showcaseId) => ipcRenderer.invoke("export-video", showcaseId),
  onExportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("export-progress", listener);
    return () => ipcRenderer.removeListener("export-progress", listener);
  },
});
