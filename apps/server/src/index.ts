import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";

import { createWsServer } from "./ws/server.js";
import { registerAzureStt } from "./stt/registerAzureStt.js";

// Load environment variables from `.env` files if present.
// NODE_ENV-aware: development → .env.development, test → .env.test, production → .env.production.
// Falls back to .env if env-specific file does not exist.
// Order: env-specific first, then .env; apps/server/ first, then repo root.
// We never read/print the file contents; this just populates `process.env`.
// We intentionally do NOT override already-set variables.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const serverDir = resolve(__dirname, ".."); // apps/server
const repoRoot = resolve(__dirname, "../../.."); // repo root

const nodeEnv = process.env.NODE_ENV ?? "development";
const envSuffix =
  nodeEnv === "development"
    ? "development"
    : nodeEnv === "test"
      ? "test"
      : nodeEnv === "production"
        ? "production"
        : null;

function loadEnv(dir: string) {
  if (envSuffix) {
    const envSpecific = resolve(dir, `.env.${envSuffix}`);
    if (existsSync(envSpecific)) dotenv.config({ path: envSpecific });
  }
  const envPath = resolve(dir, ".env");
  if (existsSync(envPath)) dotenv.config({ path: envPath });
}

loadEnv(serverDir);
loadEnv(repoRoot);

const port = Number(process.env.PORT ?? 8787);

function withCors(res: http.ServerResponse) {
  // Dev-friendly CORS (token is ephemeral; still short-lived).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

const server = http.createServer((req, res) => {
  withCors(res);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
});

const ws = createWsServer({ server });

registerAzureStt(ws);

server.listen(port);

// eslint-disable-next-line no-console
console.log(`Server listening on http://localhost:${port} (WS)`);

