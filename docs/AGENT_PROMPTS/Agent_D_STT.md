# Agent_D_STT — OpenAI Realtime transcription + turn boundaries

## Mission
Implement the server-side streaming STT adapter (OpenAI Realtime transcription) and emit `stt.partial`, `stt.final`, plus explicit `turn.start`/`turn.final`.

## Milestone focus
**Milestone 1 (STT-only)**: deliver streaming transcription into the UI (`turn.*` + `stt.*`). Translation is explicitly out of scope.

## Allowed paths (hard)
- `apps/server/**`

## Forbidden
- Do not edit `packages/shared/**` or root configs.
- Do not implement translation.

## Required reading
- `docs/PRODUCT.md`
- `docs/ESCALATIONS/README.md`
- `packages/shared/src/protocol.ts`
- `packages/shared/src/providers.ts`
- `packages/shared/src/segmentation.ts`

## Escalation process (no chat relay)
If you need a gatekeeper decision or a contract change, create an escalation file under `docs/ESCALATIONS/` (see `docs/ESCALATIONS/README.md`).
In the agent chat, post only: `Filed escalation docs/ESCALATIONS/<filename>; status=open; blocked until answered.`
Do not paste escalation details into chat.

## Requirements
- Add an STT adapter module that can be called by the WS session code.
- Use OpenAI Realtime transcription (server-side API key).
- Emit:
  - `turn.start` when a new turn begins
  - `stt.partial` during streaming
  - `stt.final` when provider finalizes or when your segmentation finalizes
  - `turn.final` when turn closes
- Turn boundary heuristic:
  - close turn after `silenceGapMs` with no speech updates, and/or
  - force boundary at `maxTurnMs`
  - (optional) use provider VAD boundaries if available

The UI must not merge rapid consecutive speakers into one block; ensure turn ids change in those cases.

## Acceptance checklist
- Produces distinct turns under rapid turn-taking (silence gaps).
- Emits timestamps (`startMs`, `endMs`) that are monotonic within a turn.
- Handles reconnect / stop cleanly.

## Local test
- Run `pnpm -C apps/server dev` with `OPENAI_API_KEY` set.
- Use the web app (once Agent_B exists) or a small test client to stream audio.
