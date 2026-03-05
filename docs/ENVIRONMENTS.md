# Environments

This project uses three environments: **dev**, **test**, and **prod**.

| Environment | Purpose | How to run | Env file | Default ports |
|-------------|---------|------------|----------|----------------|
| **Dev** | Local development with hot reload | `pnpm dev` | `.env.development` | Web 5173, server 8787 |
| **Test** | Local Docker stack (integration testing before NAS deploy) | `pnpm test:docker` | `.env.test` | oauth2-proxy 4181 |
| **Prod** | Production deployment on NAS | `docker compose up -d` on NAS | `.env` (create from `.env.example.production`) | oauth2-proxy 4180 |

Ports are configurable via env vars so dev and test can run side by side.

**Port env vars:**
- Dev: `PORT` (server), `VITE_DEV_PORT` (web), `VITE_WS_URL` or `VITE_WS_PORT` (WebSocket)
- Test: `OAUTH2_PROXY_HOST_PORT` (host port for oauth2-proxy; default 4181 in `.env.example.test`)
- Prod: `OAUTH2_PROXY_HOST_PORT` (default 4180 when not set)

## Creating env files

Copy the appropriate template and fill in your values:

| Environment | Copy from | To |
|-------------|-----------|-----|
| Dev | `.env.example.development` | `.env.development` |
| Test | `.env.example.test` | `.env.test` |
| Prod (NAS) | `.env.example.production` | `.env` |

Never commit actual env files (they contain secrets). The `.env.example.*` templates are committed.

## Dev

- **Run:** `pnpm dev`
- **Uses:** `.env.development` (or `.env` if development file does not exist)
- **Access:** Web at http://localhost:5173 (configurable via `VITE_DEV_PORT`), server at ws://localhost:8787 (configurable via `PORT`, `VITE_WS_URL`)

## Test

- **Run:** `pnpm test:docker` (start) / `pnpm test:docker:down` (stop)
- **Uses:** `.env.test` for all services
- **Access:** http://localhost:4181 (configurable via `OAUTH2_PROXY_HOST_PORT`; differs from prod’s 4180 so you can run both)
- **Email allowlist:** `ops/oauth2-proxy/emails.test.yaml` (separate from prod)
- **Tailscale:** Use `docker compose --profile funnel ...` to include Tailscale for Funnel testing

Test is for validating the full Docker stack locally before deploying to NAS. Use a separate OAuth client and allowlist so test credentials stay isolated from production.

## Prod

- **Run:** On NAS, `docker compose up -d` (see `docs/deploy-nas.md`)
- **Uses:** `.env` on the NAS (create from `.env.example.production`)
- **Email allowlist:** `ops/oauth2-proxy/emails.yaml`
- **Access:** Via Tailscale Funnel URL

## First-time setup checklist

1. Copy `.env.example.development` → `.env.development` (dev)
2. Copy `.env.example.test` → `.env.test` (test)
3. Copy `.env.example.production` → `.env.production` (prod; on NAS, copy to `.env`)
4. Edit `ops/oauth2-proxy/emails.yaml` (prod) and `ops/oauth2-proxy/emails.test.yaml` (test)

## Daily workflow

- **Dev:** `pnpm dev`
- **Test before deploy:** `pnpm test:docker`, verify at http://localhost:4181 (or your `OAUTH2_PROXY_HOST_PORT`), then `pnpm test:docker:down`
- **Prod:** Deploy to NAS per `docs/deploy-nas.md`, run `docker compose up -d` with `.env` on NAS
