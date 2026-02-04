type TranscribeResult = { text: string; language?: string };

// Some OpenAI transcription models reject `response_format: "verbose_json"`.
// We optimistically request verbose metadata, then fall back per-model.
const verboseJsonSupportByModel = new Map<string, boolean>();

export async function openaiTranscribeWav(args: {
  apiKey: string;
  wavBytes: Uint8Array;
  model: string;
  language?: string;
}): Promise<TranscribeResult> {
  const canTryVerbose =
    verboseJsonSupportByModel.get(args.model) ?? true;

  // 1) Prefer verbose_json (text + language) when supported.
  if (canTryVerbose) {
    const res = await doRequest({ ...args, responseFormat: "verbose_json" });
    if (res.ok) {
      const json = (await res.res.json()) as any;
      const text = String(json?.text ?? "");
      const language =
        typeof json?.language === "string" && json.language.length > 0
          ? String(json.language)
          : undefined;
      verboseJsonSupportByModel.set(args.model, true);
      return { text, language };
    }

    const body = await safeReadText(res.res);
    // Detect the specific incompatibility error and fall back.
    if (
      res.res.status === 400 &&
      (body.includes("response_format 'verbose_json'") ||
        body.includes("not compatible with model") ||
        body.includes("\"param\": \"response_format\""))
    ) {
      verboseJsonSupportByModel.set(args.model, false);
      // Continue to fallback below.
    } else {
      throw new Error(
        `OpenAI audio transcription failed: ${res.res.status} ${res.res.statusText}${body ? ` - ${body}` : ""}`,
      );
    }
  }

  // 2) Fallback: request plain `json` (widely supported).
  {
    const res = await doRequest({ ...args, responseFormat: "json" });
    if (!res.ok) {
      const body = await safeReadText(res.res);
      throw new Error(
        `OpenAI audio transcription failed: ${res.res.status} ${res.res.statusText}${body ? ` - ${body}` : ""}`,
      );
    }
    const contentType = res.res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const json = (await res.res.json()) as any;
      const text = String(json?.text ?? "");
      return { text };
    }
    // Defensive: if the server returns text anyway.
    const text = await res.res.text();
    return { text: String(text ?? "") };
  }
}

async function doRequest(args: {
  apiKey: string;
  wavBytes: Uint8Array;
  model: string;
  language?: string;
  responseFormat?: string;
}): Promise<{ ok: boolean; res: Response }> {
  const form = new FormData();
  // Node.js/undici FormData supports Blob with filename.
  form.append("file", new Blob([args.wavBytes], { type: "audio/wav" }), "audio.wav");
  form.append("model", args.model);
  if (args.responseFormat) form.append("response_format", args.responseFormat);
  if (args.language) form.append("language", args.language);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: form,
  });
  return { ok: res.ok, res };
}

async function safeReadText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

