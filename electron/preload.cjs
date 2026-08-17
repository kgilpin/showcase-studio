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
  terminal: {
    available: () => ipcRenderer.invoke("terminal-available"),
    start: (size) => ipcRenderer.invoke("terminal-start", size),
    stop: () => ipcRenderer.invoke("terminal-stop"),
    input: (data) => ipcRenderer.send("terminal-input", data),
    resize: (size) => ipcRenderer.send("terminal-resize", size),
    onData: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("terminal-data", listener);
      return () => ipcRenderer.removeListener("terminal-data", listener);
    },
    onExit: (callback) => {
      const listener = (_event, code) => callback(code);
      ipcRenderer.on("terminal-exit", listener);
      return () => ipcRenderer.removeListener("terminal-exit", listener);
    },
  },
  agent: {
    status: () => ipcRenderer.invoke("agent-status"),
    setKey: (key) => ipcRenderer.invoke("agent-set-key", key),
    clearKey: () => ipcRenderer.invoke("agent-clear-key"),
    reset: () => ipcRenderer.invoke("agent-reset"),
    send: (text) => ipcRenderer.invoke("agent-send", text),
    onEvent: (callback) => {
      const listener = (_event, agentEvent) => callback(agentEvent);
      ipcRenderer.on("agent-event", listener);
      return () => ipcRenderer.removeListener("agent-event", listener);
    },
  },
});
