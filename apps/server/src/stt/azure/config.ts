export type AzureSpeechConfig = {
  key: string;
  region: string;
  endpoint?: string;
  autoDetectLanguages: string[];
  translationTargets: string[];
  sampleRateHz?: number;
  enableDiarization?: boolean;
};

const DEBUG_LOGS = process.env.LIVETRANSLATE_DEBUG_LOGS === "true";

function debugLog(payload: Record<string, unknown>) {
  if (!DEBUG_LOGS) return;
  fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

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

  const autoDetectLanguages = withFallback(
    splitLangList(autoDetectRaw ?? "de-DE,en-US"),
    ["de-DE", "en-US"],
  );
  const translationTargets = withFallback(
    splitLangList(translationTargetsRaw ?? "de,en"),
    ["de", "en"],
  );

  // #region agent log
  debugLog({
    location: "azure/config.ts:loadAzureSpeechConfig",
    message: "loaded azure speech config",
    data: {
      autoDetectLanguages,
      translationTargets,
      sampleRateHz: sampleRateRaw ? Number(sampleRateRaw) : null,
      enableDiarization,
    },
    timestamp: Date.now(),
    sessionId: "debug-session",
    runId: "run1",
    hypothesisId: "H3",
  });
  // #endregion

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

