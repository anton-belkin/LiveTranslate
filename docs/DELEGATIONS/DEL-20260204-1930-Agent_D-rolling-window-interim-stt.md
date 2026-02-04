# DEL-20260204-1930-Agent_D-rolling-window-interim-stt (status: completed)

## Task
- **Agent**: Agent_D
- **Goal**: Implement “running total” interim STT by re-transcribing a rolling audio window during an active turn, to avoid independent mid-speech item artifacts.
- **Milestone**: M1 polish (interim STT rework)

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**:
  - do not edit `packages/shared/**`
  - do not implement translation

## Rationale
OpenAI Realtime transcription generates transcripts on **buffer commits**, which creates independent items mid-speech. Even if stitched, it can cause sentence restarts and artifacts. Instead, we want an interim mode that repeatedly transcribes the **running audio** for the current turn.

## Requirements
1) **Turn audio buffer (running total, capped)**
   - Maintain a PCM16 mono buffer for the current turn.
   - For interim updates, transcribe the **last `maxWindowSeconds`** of this buffer (default 20–30s), not the entire meeting.
   - If the current turn exceeds `maxWindowSeconds`, **force a turn cut** and start a new turn seeded with an **overlap** from the previous turn:
     - `overlapSeconds` default 1.0–2.0s
     - goal: avoid cutting words at the boundary.

2) **Periodic re-transcription (replace, don’t concatenate)**
   - Every `updateIntervalMs` (default 800–1500ms), call a **non-realtime STT** endpoint that accepts audio input using the capped window audio.
   - Do **not** concatenate overlapping transcripts. Each result is the new “draft transcript” for the turn.
   - Apply a “stable prefix” strategy to reduce UI jitter:
     - keep the longest common prefix between previous draft and new draft stable
     - allow rewriting only a limited tail (e.g., last 30–80 chars) if needed.
   - Emit interim updates as:
     - `stt.partial` with `segmentId = turnId` and the current draft transcript.

3) **Finalization**
   - At turn end:
     - run one final transcription (same windowing is ok)
     - emit `stt.final` with `segmentId = turnId`
     - then emit `turn.final`

4) **Backpressure / cost control**
   - Never run overlapping transcriptions; if the previous request is in flight, skip this tick.
   - Cap window audio size to keep request sizes reasonable.

5) **Compatibility**
   - Keep current Realtime VAD/turn boundary detection if it’s working.
   - Do not rely on mid-speech commits for interim text.
   - No protocol changes.

## Acceptance checklist
- While speaking, transcript updates smoothly without generating “independent sentence” artifacts from mid-speech commits.
- UI receives frequent `stt.partial` updates and a clean `stt.final` at end.
- Server remains stable (no request pile-up).
- `pnpm -C apps/server typecheck` passes.

## Notes
- It’s OK if this is more expensive than Realtime; this is a PoC option to validate UX quality.
- If you need a gatekeeper decision about which STT endpoint/model to use, file an escalation.

## Completion report (agent appends)
<!-- Agent appends below. -->

## Agent completion report (2026-02-04)
- **What I changed**
  - Reworked interim STT to a **rolling-window re-transcription** strategy during an active turn:
    - Maintain a capped PCM16 mono buffer for the current turn.
    - Every ~`STT_ROLLING_UPDATE_INTERVAL_MS` (default 1000ms), send the last ~`STT_ROLLING_MAX_WINDOW_SECONDS` (default 25s) as a WAV to the non-realtime transcription endpoint.
    - Emit `stt.partial` with `segmentId = turnId` using the latest “draft transcript” (replace, not concatenate).
  - Added a **stable-prefix** jitter reducer: keep the longest common prefix stable and allow rewriting only a limited tail (`STT_ROLLING_STABLE_TAIL_CHARS`, default 60).
  - Added **turn overlap seeding** (default ~1.5s) and a **forced turn cut** when a turn exceeds the rolling window cap, to avoid cutting words mid-boundary.
  - Kept Realtime server VAD for `turn.start`/`turn.final` boundaries and ensured we do **not** create model responses (`create_response=false` remains).
- **Files changed**
  - `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`
  - `apps/server/src/stt/openaiAudioTranscribe.ts` (new)
  - `apps/server/src/stt/wav.ts` (new)
  - `docs/DELEGATIONS/DEL-20260204-1930-Agent_D-rolling-window-interim-stt.md`
- **How to test**
  - `OPENAI_API_KEY=... pnpm -C apps/server dev`
  - Speak continuously for a few seconds:
    - UI should receive frequent `stt.partial` updates with `segmentId=turnId` (single paragraph per turn).
    - On silence, UI should receive `stt.final` then `turn.final`.
  - `pnpm -C apps/server typecheck`
- **Known issues / follow-ups**
  - **Medium (cost)**: This approach is more expensive than Realtime deltas (expected for PoC validation).
  - **Low**: If a rolling transcription call fails, the server logs a recoverable `server.error`; the next tick will try again.

