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
  folder: {
    choose: () => ipcRenderer.invoke("folder-choose"),
    reveal: () => ipcRenderer.invoke("folder-reveal"),
  },
  showcases: {
    create: (name) => ipcRenderer.invoke("showcase-create", name),
  },
  terminal: {
    available: () => ipcRenderer.invoke("terminal-available"),
    status: (options) => ipcRenderer.invoke("terminal-status", options),
    external: (options) => ipcRenderer.invoke("terminal-external", options),
    start: (options) => ipcRenderer.invoke("terminal-start", options),
    stop: (options) => ipcRenderer.invoke("terminal-stop", options),
    input: (payload) => ipcRenderer.send("terminal-input", payload),
    resize: (payload) => ipcRenderer.send("terminal-resize", payload),
    onData: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal-data", listener);
      return () => ipcRenderer.removeListener("terminal-data", listener);
    },
    onExit: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("terminal-exit", listener);
      return () => ipcRenderer.removeListener("terminal-exit", listener);
    },
  },
});
