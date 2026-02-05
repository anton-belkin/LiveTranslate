export type AzureSpeechConfig = {
  key: string;
  region: string;
  endpoint?: string;
  autoDetectLanguages: string[];
  translationTargets: string[];
  sampleRateHz?: number;
  enableDiarization?: boolean;
};

export function loadAzureSpeechConfig(
  env: NodeJS.ProcessEnv = process.env,
): AzureSpeechConfig {
  const key = env.AZURE_SPEECH_KEY;
  const region = env.AZURE_SPEECH_REGION;
  const endpoint = env.AZURE_SPEECH_ENDPOINT;
  const autoDetectRaw = env.AZURE_SPEECH_AUTO_DETECT_LANGS;
  const translationTargetsRaw = env.AZURE_SPEECH_TRANSLATION_TARGETS;
  const sampleRateRaw = env.AZURE_SPEECH_SAMPLE_RATE_HZ;
  const enableDiarization = env.AZURE_SPEECH_DIARIZATION === "true";

  if (!key || !region) {
    throw new Error(
      "Missing Azure Speech config. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION.",
    );
  }

  const autoDetectLanguages = ensureLang(
    withFallback(
      splitLangList(autoDetectRaw ?? "de-DE,en-US,ru-RU"),
      ["de-DE", "en-US", "ru-RU"],
    ),
    "ru-RU",
  );
  const translationTargets = ensureLang(
    withFallback(
      splitLangList(translationTargetsRaw ?? "de,en,ru"),
      ["de", "en", "ru"],
    ),
    "ru",
  );

  return {
    key,
    region,
    endpoint: endpoint || undefined,
    autoDetectLanguages,
    translationTargets,
    sampleRateHz: sampleRateRaw ? Number(sampleRateRaw) : undefined,
    enableDiarization,
  };
}

function splitLangList(raw: string): string[] {
  return raw
    .split(/[,\s]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function withFallback(list: string[], fallback: string[]): string[] {
  return list.length > 0 ? list : fallback;
}

function ensureLang(list: string[], lang: string): string[] {
  const exists = list.some((entry) => entry.toLowerCase() === lang.toLowerCase());
  return exists ? list : [...list, lang];
}

