# DEL-20260204-1700-Agent_D-stt-interim-while-speaking (status: completed)

## Task
- **Agent**: Agent_D
- **Goal**: Make STT text appear while the user is speaking (not only after silence).
- **Milestone**: M1 polish (STT latency)

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**:
  - do not edit `packages/shared/**` (protocol) for this change
  - do not implement translation
- **Do not change**: WS server/session registry semantics unless necessary (prefer adapter-local changes)

## Requirements
- Current behavior: transcripts arrive mostly after VAD commits (often after speech ends).
- Implement an **eager commit strategy** so transcription begins during speech:
  - Use server VAD events (`input_audio_buffer.speech_started` / `speech_stopped`) if available to detect in-speech state.
  - While in speech, periodically send `input_audio_buffer.commit` (e.g., every 300–800ms) so the provider starts transcribing earlier.
  - Continue appending audio via `input_audio_buffer.append` continuously.
  - Handle/ignore commit errors when buffer is empty (provider may emit `error`).
- Turn semantics:
  - Keep a **single logical turn** per continuous speech segment (between speech_started and speech_stopped), even if multiple commits occur.
  - Emit `turn.start` once per logical turn.
  - Emit `turn.final` once per logical turn (after speech_stopped + last segment finalized, best-effort).
  - Emit `stt.partial` as deltas arrive, and `stt.final` when completed.
  - Support multiple `segmentId`s per `turnId` (UI/store already supports this).
  - Recommendation: use your own `turnId` (uuid/increment) and map provider `item_id` → `{ turnId, segmentId=item_id }`.
- Ensure we do **not** create model responses (transcription-only behavior).

## Acceptance checklist
- While speaking continuously for ~2–3 seconds, UI shows incremental text updates during speech (not only at the end).
- Turn blocks do not merge across separate phrases; eager commits do not create a new *turn* each time.
- No crashes if OpenAI emits occasional commit-empty errors.
- `pnpm -C apps/server typecheck` passes.

## Dependencies / context
- Product goal: `docs/PRODUCT.md` (low-latency interim STT)
- Realtime transcription behavior: transcription starts on buffer commits; VAD often commits after silence.
- Relevant files:
  - `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`
  - `apps/server/src/stt/registerOpenAiStt.ts`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Agent completion report (2026-02-04)
- **What I changed**
  - Added an **eager commit loop** while `input_audio_buffer.speech_started` → `speech_stopped` so Realtime transcription begins during speech (not only after silence).
  - Refactored turn/segment mapping to keep **one logical `turnId`** per continuous speech segment, while allowing **multiple provider `item_id` segments** (`segmentId=item_id`) within that turn.
  - Made `turn.final` best-effort: emitted after speech ends and all known segments finalize (or after a short timeout).
  - Ignored expected `commit`-when-empty errors (best-effort) to avoid spamming `server.error`.
- **Files changed**
  - `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`
  - `docs/DELEGATIONS/DEL-20260204-1700-Agent_D-stt-interim-while-speaking.md`
- **How to test**
  - `OPENAI_API_KEY=... pnpm -C apps/server dev`
  - Run the web app and speak continuously for ~2–3 seconds; confirm `stt.partial` updates arrive while speaking, and turn blocks don’t split per eager commit.
  - `pnpm -C apps/server typecheck`
- **Known issues / follow-ups**
  - **Medium**: Segment timestamps are based on a local “audio cursor” estimate (monotonic) and may not perfectly match provider timings; can be improved if we standardize on provider segment timing events later.
  - **Low**: Eager commit interval is fixed at 500ms; could be tuned (e.g. 300–800ms adaptive) for latency vs cost.

