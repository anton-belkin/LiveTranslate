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

## Desktop app (Electron)
The repo also includes an Electron desktop wrapper under `apps/desktop` that:
- Loads the same Vite UI (`apps/web`)
- Spawns the same Node WS server (`apps/server`) as a managed child process
- Stores API keys in the OS credential store (Keychain / Credential Manager)

### Run desktop (dev)
In one terminal:
```bash
pnpm -C apps/web dev
```

In another terminal:
```bash
pnpm -C apps/desktop dev
```

Use the **API keys** button in the UI to enter Groq + Azure keys (the backend will restart).

### Package desktop
Unpacked (local smoke test):
```bash
pnpm -C apps/desktop run package:dir
```

Installer artifacts:
```bash
pnpm -C apps/desktop run package
```

### Permissions notes (macOS)
- Screen capture audio uses `getDisplayMedia({ audio: true, video: true })` and requires **Screen Recording** permission.
- Microphone capture requires **Microphone** permission.

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
