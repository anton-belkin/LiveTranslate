# DEL-20260204-2010-Agent_E-translation-de-en (status: completed)

## Task
- **Agent**: Agent_E
- **Goal**: Translate each finalized turn from source language to the other column language (DE↔EN) and stream results to the client.
- **Milestone**: M2a (translation for DE/EN)

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**:
  - do not edit `packages/shared/**` in this task (DE/EN only)
- **Note**: if you need to store per-session “chosen column langs”, coordinate via WS hello or file an escalation.

## Requirements
- Trigger on `stt.final` where `segmentId === turnId`.
- Determine source language:
  - use `stt.final.lang` (required for correctness; if missing, skip or detect).
- Determine target language:
  - for now, translate to the *other* of `de/en`.
- Emit streaming:
  - `translate.partial { sessionId, turnId, segmentId: turnId, from, to, textDelta }`
  - `translate.final { sessionId, turnId, segmentId: turnId, from, to, text }`
- Avoid context blow-up (no long history); basic segment-only translation is fine.

## Acceptance checklist
- For English input, German translation appears (event-wise) as `from:"en" to:"de"`.
- For German input, English translation appears as `from:"de" to:"en"`.
- Streaming deltas arrive before final for typical turns.
- `pnpm -C apps/server typecheck` passes.

## Dependencies / context
- Protocol types: `packages/shared/src/protocol.ts` (do not edit)
- WS server emit API already exists (see `apps/server/src/ws/server.ts` usage patterns)

## Completion report (agent appends)
<!-- Agent appends below. -->

- Implemented server-side streaming translation triggered by `stt.final` where `segmentId === turnId`.
- Emits `translate.partial` deltas during OpenAI stream and `translate.final` on completion, with `from/to` set to DE↔EN.
- Uses `stt.final.lang` when present; otherwise attempts lightweight heuristic detection and (if `OPENAI_API_KEY` is set) a small DE/EN detection call.
- Cancels in-flight translations on `client.stop`, idle GC, and server shutdown to avoid leaking work.
- Added optional env override `OPENAI_TRANSLATE_MODEL` (default `gpt-4o-mini`); no contract changes.
- Verified: `pnpm -C apps/server typecheck` passes.

