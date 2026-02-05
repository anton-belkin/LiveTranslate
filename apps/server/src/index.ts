import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";

import { createWsServer } from "./ws/server.js";
import { registerOpenAiStt } from "./stt/registerOpenAiStt.js";

// Load environment variables from `.env` files if present.
// Order matters: `apps/server/.env` first, then repo root `.env`.
// We never read/print the file contents; this just populates `process.env`.
// We intentionally do NOT override already-set variables.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverEnvPath = resolve(__dirname, "../.env"); // apps/server/.env
const repoRootEnvPath = resolve(__dirname, "../../../.env"); // repo root .env
if (existsSync(serverEnvPath)) {
  dotenv.config({ path: serverEnvPath });
}
if (existsSync(repoRootEnvPath)) {
  dotenv.config({ path: repoRootEnvPath });
}

const port = Number(process.env.PORT ?? 8787);

function json(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.end(payload);
}

function withCors(res: http.ServerResponse) {
  // Dev-friendly CORS (token is ephemeral; still short-lived).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

const server = http.createServer(async (req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = req.url ?? "/";
  if (req.method === "GET" && url.startsWith("/token")) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      json(res, 500, { error: "OPENAI_API_KEY is not set" });
      return;
    }

    const model = process.env.OPENAI_REALTIME_MODEL ?? "gpt-realtime";
    const transcriptionModel =
      process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-mini-transcribe";
    const ttlSeconds = Number(process.env.OPENAI_EPHEMERAL_TTL_SECONDS ?? 600);

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:/token:entry',message:'/token request',data:{model,ttlSeconds},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A'})}).catch(()=>{});
    // #endregion

    try {
      const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          expires_after: { anchor: "created_at", seconds: ttlSeconds },
          session: {
            type: "realtime",
            model,
            // We only want text events; no model audio output.
            output_modalities: ["text"],
            instructions:
              "You are LiveTranslate. Do not produce conversational replies. " +
              "We use this session for input audio transcription and tool-driven translation patches.",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: 24000 },
                noise_reduction: { type: "near_field" },
                transcription: { model: transcriptionModel },
                turn_detection: {
                  type: "server_vad",
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 250,
                  // Critical: do not auto-generate responses from VAD.
                  create_response: false,
                  interrupt_response: false,
                },
              },
            },
          },
        }),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => "");
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:/token:error',message:'client_secrets failed',data:{status:r.status,statusText:r.statusText,bodyLen:text.length},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A'})}).catch(()=>{});
        // #endregion
        json(res, 500, {
          error: `Failed to mint client secret: ${r.status} ${r.statusText}${text ? ` - ${text}` : ""}`,
        });
        return;
      }

      const data = (await r.json()) as unknown;
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'server/index.ts:/token:ok',message:'client_secrets ok',data:{status:r.status},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      json(res, 200, data);
      return;
    } catch (err) {
      json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      return;
    }
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
});

const ws = createWsServer({ server });

// STT-only milestone: wire streaming transcription into the WS audio pipeline.
registerOpenAiStt(ws);

server.listen(port);

// eslint-disable-next-line no-console
console.log(`Server listening on http://localhost:${port} (WS + /token)`);

