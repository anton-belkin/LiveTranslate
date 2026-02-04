# ESC-20260204-1423-Agent_B-M1-completion (status: open)

## Agent request
- **Agent**: Agent_B
- **Work package**: WP-B
- **Need**: Milestone 1 completion report (review requested)
- **Why**: Gatekeeper review + integration sign-off
- **Options**: N/A
- **Preferred**: Approve / request changes
- **Contract impact**:
  - **Assumptions**:
    - Web client sends `client.hello` on WS open (per `packages/shared/src/protocol.ts`) even though the placeholder server immediately closes today.
    - Audio is framed at ~20ms (\(\approx\) 320 samples @ 16kHz) and sent as `audio.frame` with `format: "pcm_s16le"`, `channels: 1`, `pcm16Base64`.
  - **Potential mismatches / notes**:
    - `apps/web` now aliases `@livetranslate/shared` to the TS source (`packages/shared/src/index.ts`) to avoid requiring a build step for `packages/shared` during web dev/build. If the repo intends `@livetranslate/shared` to always be consumed from its built `dist/`, this alias should be revisited.
    - WS URL is configured via `VITE_WS_URL` (fallback `ws://localhost:8787`). Repo root `.env.example` uses `PUBLIC_WS_URL`; web currently does not read that variable name.
    - The audio pipeline always *outputs* 16kHz PCM (worklet resampling), but the browser’s `AudioContext` may run at a different hardware rate; this is handled by resampling in the worklet.
  - **Backward compatible?**: Yes (no contract file changes).
- **Proposed approach**:
  - **What you implemented**:
    - Microphone capture via `getUserMedia({ audio: true })` and WebAudio pipeline.
    - Mono mixdown + resampling to 16kHz + framing to ~20ms chunks.
    - PCM16 little-endian encoding and base64 payload creation.
    - WebSocket client that sends `client.hello`, streams `audio.frame`, and sends `client.stop` on Stop.
    - Minimal Start/Stop UI with streaming diagnostics (frames count, sample rates, WS state, last server message).
  - **Exact files changed**:
    - `apps/web/src/ui/App.tsx`
    - `apps/web/src/audio/micStreamer.ts`
    - `apps/web/src/audio/pcm16ResampleWorklet.ts`
    - `apps/web/src/audio/audioworklet-globals.d.ts`
    - `apps/web/src/ws/WsClient.ts`
    - `apps/web/src/lib/base64.ts`
    - `apps/web/src/vite-env.d.ts`
    - `apps/web/tsconfig.json`
    - `apps/web/vite.config.ts`
  - **How to run/test**:
    - Install deps:
      - `pnpm install`
    - Run server placeholder:
      - `pnpm -C apps/server dev`
    - Run web:
      - `pnpm -C apps/web dev`
    - Manual steps:
      - Open the web app (Vite prints the URL).
      - Click **Start mic**, grant permission.
      - Confirm “Frames sent” increments (target cadence ~20ms).
      - Click **Stop**; confirm it stops cleanly; click **Start mic** again; confirm it restarts without refresh.
    - Optional:
      - Configure WS URL:
        - Set `VITE_WS_URL` (defaults to `ws://localhost:8787`).
  - **Known issues / TODOs**:
    - **High**: `apps/server` is still a placeholder that closes immediately; end-to-end STT cannot be validated yet (client is resilient and will keep reconnecting).
    - **Medium**: Web app uses `eslint` v9 in `package.json`, but the repo does not include an `eslint.config.*`; `pnpm -C apps/web lint` currently fails due to missing config (appears pre-existing repo setup gap).
    - **Low**: `base64FromArrayBuffer` uses a simple loop + `btoa`; OK for small frames, but could be optimized if CPU becomes a concern.
    - **Low**: AudioWorklet requires modern browser support; localhost is fine for secure-context requirements.
  - **Anything you need from gatekeeper**:
    - Confirm whether the `@livetranslate/shared` alias-to-source approach in `apps/web` is acceptable for this PoC, or if the expectation is to build `packages/shared` and consume from `dist/`.
    - Confirm preferred env var name for the web WS URL (`VITE_WS_URL` vs `PUBLIC_WS_URL`) for consistency across repo docs/config.

## Gatekeeper response
### Decision: approved for Milestone 1 (with 2 consistency fixes)

- **Approved**: mic capture + AudioWorklet framing to ~20ms + PCM16 mono is exactly what we need for Milestone 1.
- **Critical integration fix (done)**: the app was generating its own `sessionId` for `audio.frame`, but the server issues a `sessionId` in `server.ready`. That mismatch causes `session_mismatch` on the server. I updated the web app to **wait for `server.ready`** and use the server-issued session id for `audio.frame` and `client.stop`.
- **Shared package consumption**: the `@livetranslate/shared` alias-to-TS-source approach in Vite/tsconfig is acceptable for this PoC. It avoids needing a `packages/shared build` step during dev. If we later need a stricter “consume built dist only” rule, we can change this then.
- **Env var naming**: we standardize the web app on `VITE_WS_URL` (already used by UI store). I recommend updating `.env.example` to include `VITE_WS_URL` for clarity (gatekeeper can do this next).

