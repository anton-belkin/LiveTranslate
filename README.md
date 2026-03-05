# LiveTranslate (DE↔EN) — multi-agent PoC

This repo is intentionally structured for **multi-agent development**:
- `packages/shared` defines the **contracts** (WebSocket protocol + provider interfaces + segmentation state).
- Agents implement isolated modules under `apps/web` and `apps/server` and integrate only via `packages/shared`.

Start here for product context: `docs/PRODUCT.md`.

## Prereqs
- Node.js 20+
- pnpm (enable via Corepack, see below)

## Install

If `pnpm` is not found, enable it first (Node.js 20+ ships with Corepack):
```bash
corepack enable
```

Then install dependencies:
```bash
pnpm install
```

## Run (two terminals recommended)
```bash
pnpm -C apps/server dev
```

```bash
pnpm -C apps/web dev
```

Or run both (pnpm will run `dev` in all apps):
```bash
pnpm dev
```

## Environments

| Environment | Run | Env file |
|-------------|-----|----------|
| **Dev** | `pnpm dev` | `.env.development` (create from `.env.example.development`) |
| **Test** | `pnpm test:docker` | `.env.test` (create from `.env.example.test`). Access at http://localhost:4181. Use `--profile funnel` to include Tailscale. |
| **Prod** | See `docs/deploy-nas.md` | `.env` on NAS (create from `.env.example.production`) |

See `docs/ENVIRONMENTS.md` for full setup and usage.

## Run with Docker + Tailscale Funnel

The containerized stack uses:
- `oauth2-proxy` for Google SSO + email allowlist
- `caddy` to serve the web app and proxy `/ws`
- `server` for WebSocket + STT/translation
- `tailscale` sidecar to expose the stack via Funnel

- **Test (local Docker):** `pnpm test:docker` — uses `.env.test`, access at http://localhost:4181
- **Prod (NAS):** Follow `docs/deploy-nas.md` — uses `.env` on the NAS

Quick start for test (after configuring `.env.test` and `ops/oauth2-proxy/emails.test.yaml`):
```bash
docker compose build
pnpm test:docker
```

## Lesson learned: shared dist must be fresh
`apps/web` and `apps/server` consume `packages/shared` from `dist/`. If that build is stale,
fields like `specialWords` can get dropped by the server schema. During dev, always run the
shared watch build (included in `pnpm dev`) so `packages/shared/dist` stays current.

## Audio capture caveat (pure web app)
This PoC starts with **microphone capture** (works even for Zoom/Teams desktop apps):
- It will prompt for mic permission (`getUserMedia({ audio: true })`).
- On macOS with built-in speakers+mic, some setups capture meeting audio “cleanly” through the mic input; do not treat this as guaranteed behavior across all devices/headphones.

Optional later: add tab-audio (`getDisplayMedia({ audio: true })`) and/or multi-source mixing if needed.

## Multi-agent workflow (important)
1) Read the contracts:
   - `packages/shared/src/protocol.ts`
   - `packages/shared/src/providers.ts`
   - `packages/shared/src/segmentation.ts`
2) Pick a work package from `docs/WORKPACKAGES.md`
3) Open the corresponding prompt in `docs/AGENT_PROMPTS/`
4) Spawn a new Cursor agent chat and paste the prompt file contents.
5) In that agent chat, only attach/mention the assigned folder:
   - Web agents: `@apps/web/`
   - Server agents: `@apps/server/`
6) Do not share this chat’s history with feature agents—treat `packages/shared` + `docs/*` as their “spec”.
Agents must not modify contracts unless the gatekeeper instructs it.
