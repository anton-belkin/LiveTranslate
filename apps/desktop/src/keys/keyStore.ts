import * as keytar from "keytar";

function debugLog(message: string, data: Record<string, unknown> = {}, hypothesisId = "G", runId = "pre-fix") {
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId,
      hypothesisId,
      location: "apps/desktop/src/keys/keyStore.ts",
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

import type { StoredApiKeys } from "../state.js";

const SERVICE = "LiveTranslate";

const ACCOUNTS = {
  azureSpeechKey: "AZURE_SPEECH_KEY",
  azureSpeechRegion: "AZURE_SPEECH_REGION",
  azureSpeechEndpoint: "AZURE_SPEECH_ENDPOINT",
  groqApiKey: "GROQ_API_KEY"
} as const;

export type ApiKeysStatus = {
  hasAzureSpeechKey: boolean;
  hasAzureSpeechRegion: boolean;
  hasGroqApiKey: boolean;
};

export class KeyStore {
  async load(): Promise<StoredApiKeys> {
    // #region agent log
    debugLog("keyStore.load start", {
      keytarType: typeof keytar,
      keytarKeys: Object.keys(keytar ?? {}),
      hasGetPassword: typeof (keytar as { getPassword?: unknown })?.getPassword
    }, "G");
    // #endregion
    const [azureSpeechKey, azureSpeechRegion, azureSpeechEndpoint, groqApiKey] = await Promise.all(
      [
        keytar.getPassword(SERVICE, ACCOUNTS.azureSpeechKey),
        keytar.getPassword(SERVICE, ACCOUNTS.azureSpeechRegion),
        keytar.getPassword(SERVICE, ACCOUNTS.azureSpeechEndpoint),
        keytar.getPassword(SERVICE, ACCOUNTS.groqApiKey)
      ],
    );

    // #region agent log
    debugLog("keyStore.load done", {
      hasAzureSpeechKey: Boolean(azureSpeechKey),
      hasAzureSpeechRegion: Boolean(azureSpeechRegion),
      hasAzureSpeechEndpoint: Boolean(azureSpeechEndpoint),
      hasGroqApiKey: Boolean(groqApiKey)
    }, "G");
    // #endregion

    return {
      azureSpeechKey: azureSpeechKey || undefined,
      azureSpeechRegion: azureSpeechRegion || undefined,
      azureSpeechEndpoint: azureSpeechEndpoint || undefined,
      groqApiKey: groqApiKey || undefined
    };
  }

  async save(keys: {
    azureSpeechKey: string;
    azureSpeechRegion: string;
    azureSpeechEndpoint?: string;
    groqApiKey: string;
  }) {
    // #region agent log
    debugLog("keyStore.save start", {
      hasSetPassword: typeof (keytar as { setPassword?: unknown })?.setPassword,
      hasDeletePassword: typeof (keytar as { deletePassword?: unknown })?.deletePassword
    }, "H");
    // #endregion
    await Promise.all([
      keytar.setPassword(SERVICE, ACCOUNTS.azureSpeechKey, keys.azureSpeechKey),
      keytar.setPassword(SERVICE, ACCOUNTS.azureSpeechRegion, keys.azureSpeechRegion),
      keytar.setPassword(SERVICE, ACCOUNTS.azureSpeechEndpoint, keys.azureSpeechEndpoint ?? ""),
      keytar.setPassword(SERVICE, ACCOUNTS.groqApiKey, keys.groqApiKey)
    ]);
    // #region agent log
    debugLog("keyStore.save done", {}, "H");
    // #endregion
  }

  statusFrom(keys: StoredApiKeys): ApiKeysStatus {
    return {
      hasAzureSpeechKey: Boolean(keys.azureSpeechKey?.trim()),
      hasAzureSpeechRegion: Boolean(keys.azureSpeechRegion?.trim()),
      hasGroqApiKey: Boolean(keys.groqApiKey?.trim())
    };
  }
}

