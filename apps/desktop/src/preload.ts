import { contextBridge, ipcRenderer } from "electron";

// #region agent log
fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    runId: "pre-fix",
    hypothesisId: "C",
    location: "apps/desktop/src/preload.ts",
    message: "preload loaded",
    data: {},
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

export type ApiKeys = {
  azureSpeechKey: string;
  azureSpeechRegion: string;
  azureSpeechEndpoint?: string;
  groqApiKey: string;
};

export type ApiKeysStatus = {
  hasAzureSpeechKey: boolean;
  hasAzureSpeechRegion: boolean;
  hasGroqApiKey: boolean;
};

const api = {
  getAppInfo: () =>
    ipcRenderer.invoke("app.getInfo") as Promise<{ version: string; platform: string }>,
  getWsUrl: () => ipcRenderer.invoke("app.getWsUrl") as Promise<string>,

  getApiKeysStatus: () => ipcRenderer.invoke("keys.getStatus") as Promise<ApiKeysStatus>,
  setApiKeys: (keys: ApiKeys) => ipcRenderer.invoke("keys.set", keys) as Promise<ApiKeysStatus>,

  importKeysFile: () => ipcRenderer.invoke("keys.importFile") as Promise<ApiKeysStatus>,
  exportKeysFile: () => ipcRenderer.invoke("keys.exportFile") as Promise<void>
};

contextBridge.exposeInMainWorld("livetranslateDesktop", api);

// #region agent log
fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    runId: "pre-fix",
    hypothesisId: "C",
    location: "apps/desktop/src/preload.ts",
    message: "bridge exposed",
    data: { keys: Object.keys(api) },
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

