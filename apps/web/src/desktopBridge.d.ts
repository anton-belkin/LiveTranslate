export {};

declare global {
  type LiveTranslateApiKeys = {
    azureSpeechKey: string;
    azureSpeechRegion: string;
    azureSpeechEndpoint?: string;
    groqApiKey: string;
  };

  type LiveTranslateApiKeysStatus = {
    hasAzureSpeechKey: boolean;
    hasAzureSpeechRegion: boolean;
    hasGroqApiKey: boolean;
  };

  interface Window {
    livetranslateDesktop?: {
      getAppInfo: () => Promise<{ version: string; platform: string }>;
      getWsUrl: () => Promise<string>;
      getApiKeysStatus: () => Promise<LiveTranslateApiKeysStatus>;
      setApiKeys: (keys: LiveTranslateApiKeys) => Promise<LiveTranslateApiKeysStatus>;
      importKeysFile: () => Promise<LiveTranslateApiKeysStatus>;
      exportKeysFile: () => Promise<void>;
    };
  }
}

