# Work packages (multi-agent)

This document is the **handoff boundary** between independent agents. Agents must not rely on chat history—only on the referenced files.

## Dependency graph
- **Gatekeeper contracts first**: `packages/shared/**` must exist and be treated as stable.
- After that, these can proceed in parallel:
  - Web audio capture (`apps/web`)
  - Server WS session mgmt (`apps/server`)
  - STT adapter (`apps/server`)
  - Translation adapter (`apps/server`)
  - UI (`apps/web`)

## Milestones (recommended checkpoints)

### Milestone 1: STT-only into UI
- End-to-end: mic audio capture → WS server → streaming STT → UI renders `turn.*` + `stt.*`.
- Translation is explicitly out of scope for this checkpoint.

### Milestone 2: Add translation
- Trigger on `stt.final` and stream `translate.partial`/`translate.final` into the UI.

## Ownership rules (hard)
- **Only the gatekeeper** changes `packages/shared/**` and `docs/**` unless explicitly requested.
- Feature agents touch only their assigned `apps/*` subtree.

## Work packages

### WP-B: WebAudio capture + framing (Agent_B_WebAudio)
- **Allowed paths**: `apps/web/**`
- **Inputs**: `docs/PRODUCT.md`, `packages/shared/src/protocol.ts`
- **Output**:
  - Start/Stop capture of mic audio (`getUserMedia({ audio: true })`)
  - Convert to mono PCM16 @ 16kHz (or documented rate) and send `audio.frame`
- **Acceptance**:
  - Sends frames at roughly 20ms cadence
  - Graceful stop + re-start without refresh

### WP-C: WebSocket server + session lifecycle (Agent_C_ServerWS)
- **Allowed paths**: `apps/server/**`
- **Inputs**: `docs/PRODUCT.md`, `packages/shared/src/protocol.ts`
- **Output**:
  - WS server accepts `client.hello` then `audio.frame`
  - Routes server events back to client
  - Backpressure handling (drop/queue policy must be documented)
- **Acceptance**:
  - Works with a dumb client sending frames
  - Doesn’t crash on reconnects

### WP-D: STT adapter + turn boundaries (Agent_D_STT)
- **Allowed paths**: `apps/server/**`
- **Inputs**: `docs/PRODUCT.md`, `packages/shared/src/providers.ts`, `packages/shared/src/segmentation.ts`, `packages/shared/src/protocol.ts`
- **Output**:
  - Streaming STT adapter (OpenAI Realtime transcription)
  - Emits `stt.partial`, `stt.final`, and `turn.start/turn.final`
- **Acceptance**:
  - Distinct turns produced under rapid turn-taking (silence gap heuristic)
  - Timestamps present and monotonic per turn

### WP-E: Translation adapter streaming (Agent_E_Translate)
- **Allowed paths**: `apps/server/**`
- **Inputs**: `docs/PRODUCT.md`, `packages/shared/src/providers.ts`, `packages/shared/src/protocol.ts`
- **Output**:
  - Translate finalized STT segments DE↔EN
  - Stream `translate.partial` and finalize `translate.final`
- **Acceptance**:
  - Correct language routing for DE/EN
  - Streaming behavior verified (not only final)

### WP-F: Two-column UI (Agent_F_UI)
- **Allowed paths**: `apps/web/**`
- **Inputs**: `docs/PRODUCT.md`, `packages/shared/src/protocol.ts`
- **Output**:
  - Two columns (DE / EN)
  - Distinct turn blocks, no merging
  - Color-code original vs translated; interim vs final
- **Acceptance**:
  - Handles partial updates smoothly
  - Performs well for long transcripts

### WP-G: Latency polish + metrics (Agent_G_Latency_Polish)
- **Allowed paths**: as needed (after integration)
- **Output**:
  - Tune chunk sizes/timeouts
  - Add lightweight metrics (E2E latency per segment)
- **Acceptance**:
  - Metric emitted to console/UI for debugging
  - No material regression in stability
