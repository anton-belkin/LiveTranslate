const { contextBridge, ipcRenderer } = require("electron");

// #region agent log
fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    runId: "pre-fix",
    hypothesisId: "C",
    location: "apps/desktop/preload.cjs",
    message: "preload.cjs loaded",
    data: {},
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

const api = {
  getAppInfo: () => ipcRenderer.invoke("app.getInfo"),
  getWsUrl: () => ipcRenderer.invoke("app.getWsUrl"),

  getApiKeysStatus: () => ipcRenderer.invoke("keys.getStatus"),
  setApiKeys: (keys) => ipcRenderer.invoke("keys.set", keys),

  importKeysFile: () => ipcRenderer.invoke("keys.importFile"),
  exportKeysFile: () => ipcRenderer.invoke("keys.exportFile")
};

contextBridge.exposeInMainWorld("livetranslateDesktop", api);

// #region agent log
fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    runId: "pre-fix",
    hypothesisId: "C",
    location: "apps/desktop/preload.cjs",
    message: "bridge exposed",
    data: { keys: Object.keys(api) },
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

