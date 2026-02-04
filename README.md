# LiveTranslate (DE↔EN) — multi-agent PoC

This repo is intentionally structured for **multi-agent development**:
- `packages/shared` defines the **contracts** (WebSocket protocol + provider interfaces + segmentation state).
- Agents implement isolated modules under `apps/web` and `apps/server` and integrate only via `packages/shared`.

Start here for product context: `docs/PRODUCT.md`.

## Prereqs
- Node.js 20+
- pnpm

## Install
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

## Audio capture caveat (pure web app)
This PoC captures meeting audio using **browser tab share**:
- You must choose a **tab** in the share picker
- You must enable **Share tab audio**

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
