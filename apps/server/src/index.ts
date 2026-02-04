import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

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

const ws = createWsServer({ port });

// STT-only milestone: wire streaming transcription into the WS audio pipeline.
registerOpenAiStt(ws);

// eslint-disable-next-line no-console
console.log(`WS server listening on ws://localhost:${port}`); 

