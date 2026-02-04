# Agent_E_Translate — streaming translation DE↔EN

## Mission
Translate finalized segments DE↔EN with streaming output and emit `translate.partial` / `translate.final` (and optionally `translate.revise` later).

## Milestone focus
**Milestone 2 (Translation)**: only start after Milestone 1 (STT-only into UI) is working.

## Allowed paths (hard)
- `apps/server/**`

## Forbidden
- Do not edit `packages/shared/**` or `docs/**` or root configs.
- Do not change STT code except wiring to consume finalized segments.

## Required reading
- `docs/PRODUCT.md`
- `packages/shared/src/protocol.ts`
- `packages/shared/src/providers.ts`

## Requirements
- Translation triggers on `stt.final` segments.
- Determine direction:
  - if `stt.final.lang` is present, use it
  - otherwise do a lightweight detection (DE vs EN) before translating
- Use a server-side LLM API with streaming (OpenAI Responses streaming is fine).
- Emit streaming deltas with `translate.partial { textDelta }` and complete with `translate.final { text }`.
- Keep context bounded (e.g., last N segments) to avoid context blow-up.

## Acceptance checklist
- Streaming deltas arrive before final text for typical segments.
- Correct routing DE→EN and EN→DE.
- Failures emit `server.error` (recoverable when possible) and don’t crash the server.

## Local test
- With STT adapter active, speak German/English and verify both columns populate.
