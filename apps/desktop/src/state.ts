export type StoredApiKeys = {
  azureSpeechKey?: string;
  azureSpeechRegion?: string;
  azureSpeechEndpoint?: string;
  groqApiKey?: string;
};

// v0: in-memory only. Later tasks replace this with OS keychain + encrypted import/export.
export const state: {
  keys: StoredApiKeys;
} = {
  keys: {}
};

