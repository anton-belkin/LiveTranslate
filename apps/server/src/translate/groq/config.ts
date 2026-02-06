export type GroqConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
  targetLangs: string[];
  staticContext?: string;
};

const DEFAULT_BASE_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "openai/gpt-oss-120b";
const DEFAULT_TARGET_LANGS = ["en", "de", "ru"];

export function loadGroqConfig(env: NodeJS.ProcessEnv = process.env): GroqConfig {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing Groq config. Set GROQ_API_KEY.");
  }

  const baseUrl = env.GROQ_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const model = env.GROQ_MODEL?.trim() || DEFAULT_MODEL;
  const targetLangs = withFallback(splitList(env.GROQ_TARGET_LANGS), DEFAULT_TARGET_LANGS);
  const staticContext = env.GROQ_STATIC_CONTEXT?.trim();

  return {
    apiKey,
    baseUrl,
    model,
    targetLangs,
    staticContext: staticContext || undefined,
  };
}

function splitList(raw?: string): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/g)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function withFallback(list: string[], fallback: string[]) {
  return list.length > 0 ? list : fallback;
}
