import dotenv from "dotenv";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import http from "node:http";
import { createWsServer } from "./ws/server.js";
import { registerAzureStt } from "./stt/registerAzureStt.js";
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
function withCors(res) {
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
