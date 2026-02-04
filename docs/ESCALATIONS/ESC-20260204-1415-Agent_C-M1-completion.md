# ESC-20260204-1415-Agent_C-M1-completion (status: open)

## Agent request
- **Agent**: Agent_C
- **Work package**: WP-C
- **Need**: Milestone 1 completion report (review requested)
- **Why**: Gatekeeper review + integration sign-off
- **Options**: N/A
- **Preferred**: Approve / request changes
- **Contract impact**:
  - **files/events/types impacted (if any)**: None (no changes to `packages/shared/**`)
  - **is this backward compatible? (yes/no)**: Yes
  - **assumptions / mismatches found**:
    - `client.hello` does not carry a `sessionId`, so “reconnect/resume” can’t be declared during hello. Current implementation resumes a prior session when the client sends an `audio.frame` with a known `sessionId` after completing `client.hello`.
    - Backpressure policy is implemented as a bounded per-session frame queue with “drop oldest, keep newest” semantics (latency-first). This may drop audio under load by design.

- **Proposed approach**:
  - **What you implemented**
    - WebSocket server that validates all inbound messages via shared zod schemas, enforces `client.hello` gating, and replies with `server.ready { sessionId }`.
    - Per-session registry with reconnect/reattach support (TTL-based cleanup) and documented backpressure policy (bounded queue + drop-oldest).
    - Internal server API surface for downstream modules: `emitToSession(sessionId, msg)` and `registerAudioFrameConsumer(...)` for STT/translation to plug in without WS refactors.
    - Clean stop on `client.stop` (session teardown + socket close) plus a stop hook so STT adapters can be cleaned up reliably.
    - Minimal local sanity test path exercised (`client.hello` → `server.ready` → `audio.frame` → `client.stop`).

  - **Exact files changed (paths)**
    - `apps/server/src/index.ts`
    - `apps/server/src/ws/server.ts`
    - `apps/server/src/ws/sessionRegistry.ts`
    - `apps/server/src/ws/types.ts`
    - `apps/server/src/stt/registerOpenAiStt.ts` (hooked into session stop lifecycle)
    - `apps/server/src/ws/WsSession.ts` (import path fix only; file appears legacy/unwired)

  - **How to run/test (exact commands + manual steps)**
    - Install dependencies:
      - `pnpm install`
    - Build shared package (ensures `@livetranslate/shared` exports/types are available):
      - `pnpm -C packages/shared build`
    - Start server:
      - `pnpm -C apps/server dev`
    - Manual WS test (from server package so `ws` dep is available):
      - `pnpm -C apps/server exec node --input-type=module -e '
import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:8787");
ws.on("open", () => ws.send(JSON.stringify({ type: "client.hello", protocolVersion: 1 })));
ws.on("message", (data) => {
  const msg = JSON.parse(data.toString());
  console.log("<-", msg);
  if (msg.type === "server.ready") {
    const pcm = Buffer.alloc(20); // tiny silence frame
    ws.send(JSON.stringify({ type: "audio.frame", sessionId: msg.sessionId, pcm16Base64: pcm.toString("base64"), format: "pcm_s16le", sampleRateHz: 16000, channels: 1 }));
    ws.send(JSON.stringify({ type: "client.stop", sessionId: msg.sessionId, reason: "test" }));
  }
});
ws.on("close", (code, reason) => console.log("closed", code, reason.toString()));
'`
    - Expected results:
      - Receive `server.ready` with `sessionId`
      - If `OPENAI_API_KEY` is not set, you may also receive `server.error` with `code: "stt_error"` (expected; server should remain stable and close cleanly on `client.stop`).

  - **Known issues / TODOs**
    - **Medium**: Reconnect is supported, but “resume” is inferred on first `audio.frame` using an older `sessionId` (since protocol lacks `client.resume`). If a clearer resume handshake is desired, this likely requires a contract change in `packages/shared` (gatekeeper-owned).
    - **Low**: `apps/server/src/ws/WsSession.ts` appears to be legacy and not used by the current `apps/server/src/index.ts` entrypoint; it was updated only to fix imports. Consider deleting or clearly marking it (optional cleanup).
    - **Low**: Backpressure drop signaling uses `server.error` (rate-limited). If UI wants a non-error telemetry event later, that would be a protocol change (gatekeeper-owned).

  - **Anything you need from gatekeeper (if blocked)**
    - Not blocked. Requesting review/approval and guidance on whether to formalize reconnect/resume in the shared protocol.

## Gatekeeper response
### Decision: approved for Milestone 1 (with one integration note)

- **Approved**: WS server/session lifecycle + backpressure policy are aligned with low-latency goals. The `drop_oldest_keep_latest` queue policy is a good default for this product.
- **Integration note (important)**: the web client initially sent `audio.frame.sessionId` that didn’t match the server-issued `server.ready.sessionId`, which would trigger `session_mismatch`. I’ve fixed the web app to wait for `server.ready` and then use the server-issued session id for `audio.frame` and `client.stop`.
- **Reconnect/resume**: no shared-protocol change needed for Milestone 1. Your current “resume on first `audio.frame` with known sessionId” is acceptable as an implementation detail. We’ll revisit adding an explicit `client.resume` only if we see real UX issues or want stronger semantics.

### Follow-ups (optional, after Milestone 1 demo works)
- Consider exposing a non-error telemetry signal for drops (instead of `server.error`) once we add a debug panel (Milestone G).

