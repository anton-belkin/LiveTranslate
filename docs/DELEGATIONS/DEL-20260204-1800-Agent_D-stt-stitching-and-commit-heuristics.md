# DEL-20260204-1800-Agent_D-stt-stitching-and-commit-heuristics (status: completed)

## Task
- **Agent**: Agent_D
- **Goal**: Reduce “micro-chunks” and garbled multilingual artifacts while keeping words appearing during speech.
- **Milestone**: M1 polish (STT quality + readability)

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**:
  - do not edit `packages/shared/**` (protocol)
  - do not implement translation

## Problem statement (observed)
With eager commits enabled, one sentence becomes many tiny segments, cutting words/sentences and occasionally emitting spurious multilingual characters. Example output:
`Hello, I...` / `I would like to...` / `About this new` / `Project...` / `de hospice.` / `都。`

## Requirements
1) **Keep latency win**: `stt.partial` should still appear while speaking.
2) **Stitch segments into one coherent turn transcript**:
   - Internally you can keep multiple provider `item_id`s, but **emit a single UI-facing segment per turn**:
     - emit `stt.partial` with `segmentId = turnId` containing the **combined** text for the whole turn so far.
     - emit `stt.final` with `segmentId = turnId` containing the final combined text.
   - No protocol changes needed (same event types; just stable `segmentId`).
3) **Commit heuristics to avoid mid-word cuts**:
   - Increase eager commit interval or make it adaptive (e.g., 700–1200ms while speech is active).
   - Optional: only commit if there has been some minimum audio duration since last commit (e.g., >400ms).
4) **Reduce garbage characters** (prefer correctness over hacks):
   - Ensure session.update uses supported transcription config for Realtime GA.
   - Consider setting `audio.input.transcription.language` only if user chooses a fixed language; otherwise omit for auto-detect.\n+   - If you must post-process, do it conservatively: e.g., strip clearly invalid control chars, but do not delete legitimate German umlauts or punctuation.
5) **Turn finalization**:
   - Emit `turn.final` once per logical turn (as today).
   - Ensure the final combined `stt.final` is emitted before `turn.final`.

## Acceptance checklist
- Speaking a full sentence yields a **single live-updating paragraph** (one segment per turn), not many micro-lines.
- Words still appear while speaking (not only after silence).
- Spurious multilingual characters are significantly reduced in normal speech.
- `pnpm -C apps/server typecheck` passes.

## Dependencies / context
- Current adapter: `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Agent completion report (2026-02-04)
- **What I changed**
  - Implemented **turn-level stitching**: `stt.partial` / `stt.final` now use `segmentId = turnId` and contain the **combined transcript** for the whole turn so far (instead of per-commit micro-segments).
  - Made eager commits **adaptive** (700–1200ms) and added a **minimum-audio gate** (>450ms) to reduce mid-word cuts and “micro-chunks” while keeping in-speech updates.
  - Added conservative transcript sanitization (strip ASCII control chars) without touching umlauts/punctuation.
  - Kept transcription-only behavior (`turn_detection.create_response=false`) and retained existing Realtime GA transcription event handling.
- **Files changed**
  - `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`
  - `docs/DELEGATIONS/DEL-20260204-1800-Agent_D-stt-stitching-and-commit-heuristics.md`
- **How to test**
  - `OPENAI_API_KEY=... pnpm -C apps/server dev`
  - Speak a full sentence (~2–3s): verify the UI shows **one live-updating paragraph per turn** (not many lines) and that text updates appear while speaking.
  - `pnpm -C apps/server typecheck`
- **Known issues / follow-ups**
  - **Low**: Combined transcript still depends on provider segmentation; if the provider emits out-of-order events, we preserve commit order (best-effort).
  - **Low**: Garbage character reduction is primarily from fewer mid-word cuts; we avoid aggressive filtering to not harm legitimate multilingual text.

