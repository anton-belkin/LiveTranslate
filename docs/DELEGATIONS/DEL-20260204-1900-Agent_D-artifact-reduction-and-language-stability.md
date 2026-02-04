# DEL-20260204-1900-Agent_D-artifact-reduction-and-language-stability (status: cancelled)

## Task
- **Agent**: Agent_D
- **Goal**: Reduce garbage artifacts (e.g., CJK characters) and “independent sentence” feel while keeping in-speech partials.
- **Milestone**: M1 polish (STT quality)

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**:
  - do not edit `packages/shared/**`
  - do not implement translation

## Background (current state)
- We use eager commits to get `stt.partial` while speaking.
- We stitch into turn-level segment (`segmentId=turnId`) which fixed the UI chopping, but artifacts like `都。` still appear.

## Gatekeeper note (2026-02-04)
Cancelled: user prefers a different approach (rolling-window / running-total transcription) instead of tuning eager commits.

## Requirements
1) **Commit cadence tuning**
   - Make eager commit interval configurable via env (no protocol change), e.g.:
     - `STT_EAGER_COMMIT_MIN_MS` (default 900)
     - `STT_EAGER_COMMIT_MAX_MS` (default 1600)
     - `STT_EAGER_COMMIT_MIN_AUDIO_MS` (default 700)
   - Goal: larger chunks (more context) to reduce weird outputs, while still updating during speech.

2) **Language stability (optional, env-controlled)**
   - Add env option `OPENAI_TRANSCRIPTION_LANGUAGE`:
     - if set to `en` or `de`, pass it to `audio.input.transcription.language`
     - if unset, leave undefined (auto-detect)
   - This is primarily for testing; bilingual meetings can keep auto-detect.

3) **Artifact filtering (conservative, env-controlled)**
   - Add env option `STT_STRIP_NON_LATIN` (default false).
   - If enabled, strip characters outside a DE/EN-safe set:
     - Keep: ASCII, whitespace, punctuation, Latin-1 supplement, Latin extended blocks (at least up to U+024F), common symbols.
     - Remove: obvious CJK blocks and other scripts.
   - Apply filtering only to the **stitched combined** text right before emitting `stt.partial` / `stt.final`.
   - Keep this off by default; intended to mitigate obvious garbage in this PoC.

4) **No behavior regressions**
   - Still emit in-speech `stt.partial` updates.
   - Still emit `stt.final` before `turn.final`.

## Acceptance checklist
- With defaults, artifacts are reduced compared to prior behavior.
- With `OPENAI_TRANSCRIPTION_LANGUAGE=en`, English speech produces fewer weird multilingual artifacts.
- With `STT_STRIP_NON_LATIN=true`, CJK garbage like `都。` does not appear in output.
- `pnpm -C apps/server typecheck` passes.

## Dependencies / context
- `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`

## Completion report (agent appends)
<!-- Agent appends below. -->

