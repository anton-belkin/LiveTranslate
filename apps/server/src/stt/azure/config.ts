export type AzureSpeechConfig = {
  key: string;
  region: string;
  endpoint?: string;
  recognitionLanguage?: string;
  sampleRateHz?: number;
  enableDiarization?: boolean;
};

export function loadAzureSpeechConfig(
  env: NodeJS.ProcessEnv = process.env,
): AzureSpeechConfig {
  const key = env.AZURE_SPEECH_KEY;
  const region = env.AZURE_SPEECH_REGION;
  const endpoint = env.AZURE_SPEECH_ENDPOINT;
  const recognitionLanguage = env.AZURE_SPEECH_RECOGNITION_LANGUAGE;
  const sampleRateRaw = env.AZURE_SPEECH_SAMPLE_RATE_HZ;
  const enableDiarization = env.AZURE_SPEECH_DIARIZATION === "true";

  if (!key || !region) {
    throw new Error(
      "Missing Azure Speech config. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.",
    );
  }

  return {
    key,
    region,
    endpoint: endpoint || undefined,
    recognitionLanguage: recognitionLanguage || undefined,
    sampleRateHz: sampleRateRaw ? Number(sampleRateRaw) : undefined,
    enableDiarization,
  };
}

