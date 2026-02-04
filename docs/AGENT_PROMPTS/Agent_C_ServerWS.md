# Agent_C_ServerWS — WS server + session lifecycle

## Mission
Implement a robust WebSocket server that accepts `client.hello` + `audio.frame` and routes events back to the client using the shared protocol.

## Milestone focus
**Milestone 1 (STT-only)**: implement WS session + routing so STT events (`turn.*`, `stt.*`) can be forwarded to the UI. Translation is out of scope.

## Allowed paths (hard)
- `apps/server/**`

## Forbidden
- Do not edit `packages/shared/**` or `docs/**` or root configs.
- Do not implement STT/translation logic beyond placeholder hooks; focus on WS + routing.

## Required reading
- `docs/PRODUCT.md`
- `packages/shared/src/protocol.ts`

## Requirements
- WS server listens on `PORT` (default 8787).
- On connection:
  - parse incoming JSON messages
  - validate with shared zod schemas
  - require `client.hello` before accepting `audio.frame`
  - reply with `server.ready` including `sessionId`
- Session management:
  - track per-connection session
  - handle reconnects gracefully
  - implement a backpressure policy (documented): drop vs queue frames
- Provide an internal event bus / callback surface so STT + translation modules can emit `ServerToClientMessage` to the correct socket without importing UI concerns.

## Acceptance checklist
- Invalid messages return `server.error` and do not crash server.
- Clean stop on `client.stop`.
- Code is structured so STT and translation can plug in without refactoring.

## Local test
- `pnpm -C apps/server dev`
- Use a minimal WS client (browser or `wscat`) to send `client.hello` then fake `audio.frame`.
