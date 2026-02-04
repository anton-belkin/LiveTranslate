# Agent_B_WebAudio — Web audio capture + PCM framing

## Mission
Implement browser tab-audio capture and stream audio frames to the server over WebSocket using the shared protocol.

## Milestone focus
**Milestone 1 (STT-only)**: just get clean audio streaming (`audio.frame`) working end-to-end. Translation is out of scope.

## Allowed paths (hard)
- `apps/web/**`

## Forbidden
- Do not edit `packages/shared/**` or `docs/**` or root configs.
- Do not add server code.

## Required reading
- `docs/PRODUCT.md`
- `packages/shared/src/protocol.ts`

## Requirements
- Capture meeting audio via microphone (default ingestion for this PoC):
  - `navigator.mediaDevices.getUserMedia({ audio: true })`
- (Optional later) support tab-audio capture for browser-based meetings:
  - `navigator.mediaDevices.getDisplayMedia({ audio: true, video: false })`
- Convert to **mono PCM16 little-endian**.
- Target sample rate: **16 kHz** if feasible; otherwise document actual rate and resampling approach.
- Send `audio.frame` messages to the server:
  - include `sessionId`, `pcm16Base64`, `sampleRateHz`, `channels: 1`.
- Implement Start/Stop UI controls (minimal is fine).

## Acceptance checklist
- Start prompts the microphone permission dialog and begins streaming audio after permission.
- Sends audio frames at ~20ms cadence (or best-effort with documented frame size).
- Stop closes tracks and WS cleanly; restart works without page refresh.

## Local test
- Run server placeholder: `pnpm -C apps/server dev`
- Run web: `pnpm -C apps/web dev`
- Confirm WS connects and frames are sent (server may currently close; keep WS client robust/retry-ready).
