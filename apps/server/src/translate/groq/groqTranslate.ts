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
  };

  const systemPrompt =
    "You are a translation engine. Return only valid JSON with keys: " +
    "`translations` (map of language code to translated text), " +
    "`sourceLang` (language code of the original utterance). " +
    "If `isFinal` is true, also return `summary` in English that updates the " +
    "full-meeting summary by combining the existing `summary` with the latest `history` " +
    "and current `utterance`. " +
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
    sourceLang:
      typeof parsed.sourceLang === "string" && parsed.sourceLang.trim().length > 0
        ? (parsed.sourceLang.trim().toLowerCase() as Lang)
        : undefined,
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
