/* Sandboxed bridge between the studio UI and the shell. The renderer
 * stays a plain web app; inside Electron it additionally sees
 * window.showcaseStudio (typed in src/lib/studio.ts). */
const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("showcaseStudio", {
  exportScreens: (showcaseId) => ipcRenderer.invoke("export-screens", showcaseId),
  exportVideo: (showcaseId) => ipcRenderer.invoke("export-video", showcaseId),
  onExportProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("export-progress", listener);
    return () => ipcRenderer.removeListener("export-progress", listener);
  },
  showcases: {
    create: (name) => ipcRenderer.invoke("showcase-create", name),
  },
  scenes: {
    edit: (payload) => ipcRenderer.invoke("scene-edit", payload),
  },
  prompter: {
    publish: (showcaseId) => ipcRenderer.invoke("prompter-publish", showcaseId),
  },
  assets: {
    rename: (payload) => ipcRenderer.invoke("asset-rename", payload),
    add: (payload) => ipcRenderer.invoke("asset-add", payload),
    remove: (payload) => ipcRenderer.invoke("asset-delete", payload),
  },
  terminal: {
    // Renderer File objects carry no path — resolve it here for
    // drag-and-drop into the terminal.
    pathForFile: (file) => webUtils.getPathForFile(file),
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
