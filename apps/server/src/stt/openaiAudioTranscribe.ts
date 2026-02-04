type TranscribeResult = { text: string };

export async function openaiTranscribeWav(args: {
  apiKey: string;
  wavBytes: Uint8Array;
  model: string;
  language?: string;
}): Promise<TranscribeResult> {
  const form = new FormData();
  // Node.js/undici FormData supports Blob with filename.
  form.append(
    "file",
    new Blob([args.wavBytes], { type: "audio/wav" }),
    "audio.wav",
  );
  form.append("model", args.model);
  if (args.language) form.append("language", args.language);

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
    },
    body: form,
  });

  if (!res.ok) {
    const body = await safeReadText(res);
    throw new Error(
      `OpenAI audio transcription failed: ${res.status} ${res.statusText}${body ? ` - ${body}` : ""}`,
    );
  }

  const json = (await res.json()) as any;
  const text = String(json?.text ?? "");
  return { text };
}

async function safeReadText(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

