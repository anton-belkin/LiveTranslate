import type { Lang } from "@livetranslate/shared";

type ChatCompletionChunk = {
  choices?: Array<{
    delta?: { content?: string | null } | null;
    finish_reason?: string | null;
  }>;
};

function otherLang(lang: Lang): Lang {
  return lang === "de" ? "en" : "de";
}

export function getTranslateTargetLang(from: Lang): Lang {
  return otherLang(from);
}

function toLangName(lang: Lang): string {
  return lang === "de" ? "German" : "English";
}

function buildTranslateMessages(args: { from: Lang; to: Lang; text: string }) {
  const fromName = toLangName(args.from);
  const toName = toLangName(args.to);
  return [
    {
      role: "system",
      content:
        `You are a translation engine. Translate from ${fromName} to ${toName}. ` +
        "Return only the translated text (no quotes, no commentary). Preserve meaning and tone.",
    },
    { role: "user", content: args.text },
  ] as const;
}

function buildDetectMessages(text: string) {
  return [
    {
      role: "system",
      content:
        "You are a language detector for DE/EN only. " +
        "Return exactly one token: 'de' or 'en'. No punctuation, no extra words.",
    },
    { role: "user", content: text },
  ] as const;
}

async function safeReadText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function* iterateSseData(res: Response): AsyncGenerator<string, void, void> {
  const body = res.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE is line-based. We only need `data:` lines.
    while (true) {
      const nl = buf.indexOf("\n");
      if (nl === -1) break;
      const rawLine = buf.slice(0, nl);
      buf = buf.slice(nl + 1);

      const line = rawLine.trim();
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (data.length === 0) continue;
      yield data;
    }
  }
}

export async function openaiTranslateStream(args: {
  apiKey: string;
  model: string;
  from: Lang;
  to: Lang;
  text: string;
  signal?: AbortSignal;
  onDelta: (textDelta: string) => void;
  onFinal: (fullText: string) => void;
}): Promise<void> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      stream: true,
      temperature: 0.2,
      messages: buildTranslateMessages({
        from: args.from,
        to: args.to,
        text: args.text,
      }),
    }),
    signal: args.signal,
  });

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `OpenAI translation failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
    );
  }

  let full = "";
  for await (const data of iterateSseData(res)) {
    if (data === "[DONE]") break;
    let json: ChatCompletionChunk | null = null;
    try {
      json = JSON.parse(data) as ChatCompletionChunk;
    } catch {
      continue;
    }

    const delta = json?.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      full += delta;
      args.onDelta(delta);
    }
  }

  args.onFinal(full);
}

export async function openaiDetectLangDeEn(args: {
  apiKey: string;
  model: string;
  text: string;
  signal?: AbortSignal;
}): Promise<Lang | null> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: args.model,
      temperature: 0,
      stream: false,
      messages: buildDetectMessages(args.text),
      max_tokens: 1,
    }),
    signal: args.signal,
  });

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `OpenAI language detection failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
    );
  }

  const json = (await res.json()) as any;
  const content = String(json?.choices?.[0]?.message?.content ?? "")
    .trim()
    .toLowerCase();
  if (content === "de" || content === "en") return content;
  return null;
}

