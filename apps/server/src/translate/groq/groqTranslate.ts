import type { Lang } from "@livetranslate/shared";
import type { GroqConfig } from "./config.js";

export type TranslationHistoryEntry = {
  text: string;
  lang?: Lang;
  translations: Record<string, string>;
};

export type GroqTranslateInput = {
  utteranceText: string;
  isFinal: boolean;
  utteranceLang?: Lang;
  targetLangs: Lang[];
  history: TranslationHistoryEntry[];
  summary: string;
  staticContext?: string;
  previousPartial?: Record<string, string>;
};

export type GroqTranslateOutput = {
  translations: Record<string, string>;
  summary?: string;
  sourceLang?: Lang;
};

export async function groqTranslate(
  config: GroqConfig,
  input: GroqTranslateInput,
): Promise<GroqTranslateOutput> {
  const payload = {
    staticContext: input.staticContext ?? "",
    summary: input.summary ?? "",
    utterance: {
      text: input.utteranceText,
      lang: input.utteranceLang ?? "und",
      isFinal: input.isFinal,
    },
    targetLangs: input.targetLangs,
    history: input.history,
    previousPartial: input.previousPartial ?? {},
  };

  const systemPrompt =
    "You are a translation engine. Input text comes from STT and may be partial or noisy. " +
    "Return only valid JSON with keys: " +
    "`translations` (map of language code to translated text), " +
    "`sourceLang` (lowercase ISO-639-1 code for the original utterance, e.g. en/de/ru). " +
    "If `isFinal` is false and the utterance does not look like normal language, " +
    "return empty `translations` and `sourceLang` as `und`. " +
    "When `isFinal` is false, add appropriate punctuation and capitalization to the translation " +
    "so it reads like well-formed partial text, even if the STT input lacks punctuation. " +
    "If `previousPartial` is provided for a target language, keep its beginning the same " +
    "and append only the new text when meaning can be preserved; if meaning changes, " +
    "you may rewrite the beginning. If the ending of the partial is ambiguous, " +
    "you may hold back translating that uncertain tail until a more complete partial arrives. " +
    "If `isFinal` is true, also return `summary` in English that rewrites the " +
    "full-meeting summary by compressing the existing `summary` plus the latest `history` " +
    "and current `utterance` into a single coherent summary (do not append). " +
    "If unsure about the source language, return `und`. " +
    "Do not include markdown or extra text.";

  const res = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload) },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Groq translate failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = safeJsonParse(content);
  if (!parsed) {
    throw new Error("Groq translate returned invalid JSON.");
  }

  const translations = normalizeTranslations(parsed.translations);
  return {
    translations,
    summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
    sourceLang: normalizeSourceLang(parsed.sourceLang, input.targetLangs),
  };
}

function normalizeTranslations(input: unknown): Record<string, string> {
  if (!input || typeof input !== "object") return {};
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim().length > 0) {
      result[key.toLowerCase()] = value.trim();
    }
  }
  return result;
}

function safeJsonParse(content: string): {
  translations?: unknown;
  summary?: unknown;
  sourceLang?: unknown;
} | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as { translations?: unknown; summary?: unknown };
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as {
          translations?: unknown;
          summary?: unknown;
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeSourceLang(value: unknown, targetLangs: Lang[]): Lang | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "und" || lower === "unknown") return undefined;
  const normalized = lower.split(/[-_]/)[0];
  if (normalized.length >= 2 && normalized.length <= 3) {
    return normalized as Lang;
  }
  const map: Record<string, Lang> = {
    english: "en",
    german: "de",
    deutsch: "de",
    russian: "ru",
  };
  if (map[normalized]) return map[normalized];
  if (targetLangs.includes(normalized as Lang)) return normalized as Lang;
  return undefined;
}
