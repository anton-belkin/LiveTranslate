import { app, dialog, ipcMain } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

import { state } from "../state.js";
import type { ServerManager } from "../server/serverManager.js";
import type { KeyStore } from "../keys/keyStore.js";
import { decryptKeysFileV1, encryptKeysFileV1, type KeysFileV1 } from "../keys/keysFile.js";

function getKeysStatus() {
  return {
    hasAzureSpeechKey: Boolean(state.keys.azureSpeechKey?.trim()),
    hasAzureSpeechRegion: Boolean(state.keys.azureSpeechRegion?.trim()),
    hasGroqApiKey: Boolean(state.keys.groqApiKey?.trim())
  };
}

export function registerIpcHandlers(args: { server: ServerManager; keyStore: KeyStore }) {
  ipcMain.handle("app.getInfo", () => {
    return { version: app.getVersion(), platform: process.platform };
  });

  ipcMain.handle("app.getWsUrl", () => {
    return args.server.getWsUrl();
  });

  ipcMain.handle("keys.getStatus", () => {
    return getKeysStatus();
  });

  ipcMain.handle(
    "keys.set",
    async (
      _ev,
      keys: { azureSpeechKey: string; azureSpeechRegion: string; azureSpeechEndpoint?: string; groqApiKey: string },
    ) => {
      const azureSpeechKey = String(keys.azureSpeechKey ?? "").trim();
      const azureSpeechRegion = String(keys.azureSpeechRegion ?? "").trim();
      const azureSpeechEndpoint = String(keys.azureSpeechEndpoint ?? "").trim();
      const groqApiKey = String(keys.groqApiKey ?? "").trim();

      if (!azureSpeechKey) throw new Error("Missing Azure Speech key.");
      if (!azureSpeechRegion) throw new Error("Missing Azure Speech region.");
      if (!groqApiKey) throw new Error("Missing Groq API key.");

      await args.keyStore.save({
        azureSpeechKey,
        azureSpeechRegion,
        azureSpeechEndpoint: azureSpeechEndpoint || undefined,
        groqApiKey
      });

      state.keys.azureSpeechKey = azureSpeechKey;
      state.keys.azureSpeechRegion = azureSpeechRegion;
      state.keys.azureSpeechEndpoint = azureSpeechEndpoint || undefined;
      state.keys.groqApiKey = groqApiKey;

      // Ensure the backend picks up new keys.
      await args.server.restart({
        AZURE_SPEECH_KEY: azureSpeechKey,
        AZURE_SPEECH_REGION: azureSpeechRegion,
        AZURE_SPEECH_ENDPOINT: azureSpeechEndpoint || undefined,
        GROQ_API_KEY: groqApiKey
      });

      return getKeysStatus();
    },
  );

  ipcMain.handle("keys.importFile", () => {
    return (async () => {
      const res = await dialog.showOpenDialog({
        title: "Import LiveTranslate keys file",
        properties: ["openFile"],
        filters: [{ name: "LiveTranslate Keys", extensions: ["livetranslate-keys", "json"] }]
      });
      if (res.canceled || res.filePaths.length === 0) return getKeysStatus();

      const filePath = res.filePaths[0];
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<KeysFileV1>;
      if (parsed.version !== 1) throw new Error("Unsupported keys file version.");

      const passphrase = `livetranslate:${app.getVersion()}:embedded`;
      const keys = decryptKeysFileV1({ passphrase, file: parsed as KeysFileV1 });

      await args.keyStore.save(keys);
      state.keys.azureSpeechKey = keys.azureSpeechKey;
      state.keys.azureSpeechRegion = keys.azureSpeechRegion;
      state.keys.azureSpeechEndpoint = keys.azureSpeechEndpoint;
      state.keys.groqApiKey = keys.groqApiKey;

      await args.server.restart({
        AZURE_SPEECH_KEY: keys.azureSpeechKey,
        AZURE_SPEECH_REGION: keys.azureSpeechRegion,
        AZURE_SPEECH_ENDPOINT: keys.azureSpeechEndpoint,
        GROQ_API_KEY: keys.groqApiKey
      });

      return getKeysStatus();
    })();
  });

  ipcMain.handle("keys.exportFile", () => {
    return (async () => {
      const azureSpeechKey = state.keys.azureSpeechKey?.trim() || "";
      const azureSpeechRegion = state.keys.azureSpeechRegion?.trim() || "";
      const groqApiKey = state.keys.groqApiKey?.trim() || "";

      if (!azureSpeechKey || !azureSpeechRegion || !groqApiKey) {
        throw new Error("Missing keys. Save keys in the app before exporting.");
      }

      const suggested = `livetranslate-keys-${app.getVersion()}.livetranslate-keys`;
      const res = await dialog.showSaveDialog({
        title: "Export LiveTranslate keys file",
        defaultPath: path.join(app.getPath("downloads"), suggested),
        filters: [{ name: "LiveTranslate Keys", extensions: ["livetranslate-keys"] }]
      });
      if (res.canceled || !res.filePath) return;

      const passphrase = `livetranslate:${app.getVersion()}:embedded`;
      const payload = encryptKeysFileV1({
        passphrase,
        appVersion: app.getVersion(),
        keys: {
          azureSpeechKey,
          azureSpeechRegion,
          azureSpeechEndpoint: state.keys.azureSpeechEndpoint,
          groqApiKey
        }
      });

      await fs.writeFile(res.filePath, JSON.stringify(payload, null, 2), "utf8");
    })();
  });

  ipcMain.handle("server.getStatus", () => {
    return { status: args.server.getStatus(), wsUrl: args.server.getWsUrl() };
  });

  ipcMain.handle("server.getRecentLogs", () => {
    return args.server.getRecentLogs();
  });
}

