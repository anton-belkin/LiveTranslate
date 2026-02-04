# DEL-20260204-2040-Agent_E-translate-on-stt-partials (status: completed)

## Task
- **Agent**: Agent_E
- **Goal**: Start translation **during speech** by translating `stt.partial` updates (not just `stt.final`), so the opposite column updates continuously.
- **Milestone**: M2a (DE/EN only)

## Product intent
- While the user is speaking, STT text updates as a rolling “draft”.
- Translation should **update on each draft update** (cost is acceptable).
- UI already supports:
  - `translate.partial` deltas (append)
  - `translate.final` (replace with final)
  - `translate.revise` (replace whole translation snapshot)

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**:
  - do not edit `packages/shared/**` (protocol already has `translate.revise`)
- **Language support**: only `de/en` for now.

## Current state (important)
- Translation is currently triggered only on `stt.final` via `registerOpenAiStt.ts` -> `translator.onSttFinal(msg)`.
- UI now renders translations, but waits for server events.

## Requirements
### 1) Trigger translation on partials (stitched mode only)
- For messages where `segmentId === turnId`:
  - On `stt.partial`: trigger/refresh translation for the draft text.
  - On `stt.final`: keep final translation behavior (ensure we end with a final translation).

### 2) Abort/replace policy (avoid backlog)
- Each new `stt.partial` update should **abort** any in-flight translation for the same `{sessionId, turnId}` and start a new one.
- Use `AbortController` (similar to current `inFlight` map).

### 3) Emission strategy (use revise snapshots)
To avoid the client accumulating partial deltas from multiple aborted translations:
- For **draft translations** (from `stt.partial`), emit `translate.revise` snapshots:
  - `translate.revise { sessionId, turnId, segmentId: turnId, from, to, revision, fullText }`
  - `revision` must be **monotonic per turn** (increment each time you emit a revise for that turn).
  - `fullText` is the current best translation of the current STT draft.
- For **final translation** (from `stt.final`), emit:
  - either `translate.final` only, or `translate.revise` (final snapshot) + `translate.final` (preferred).

### 4) Debounce / gating (even though cost OK)
Still avoid pathological request rates:
- Only trigger translation if the draft changed meaningfully, e.g.:
  - at least N new chars since last translate (suggest N=12), OR
  - at least T ms since last request (suggest T=700ms)
- Always translate the latest draft eventually.

### 5) Language handling
- Prefer `msg.lang` for `from`.
- If missing, use the existing detection logic (heuristic, optional detect call) used in `createOpenAiTranslator`.

## Suggested files
- `apps/server/src/translate/openaiTranslator.ts`
- `apps/server/src/stt/registerOpenAiStt.ts`

## Acceptance checklist
- While speaking German: English translation in the opposite column updates repeatedly before turn end.
- While speaking English: German translation updates repeatedly before turn end.
- When a turn ends, translation ends with a stable final result (`translate.final` or final revise+final).
- No runaway background translations after `client.stop` / idle timeout.
- `pnpm -C apps/server typecheck` passes.

## Completion report (agent appends)
<!-- Agent appends below. -->

- Added draft-time translation: `stt.partial` (where `segmentId === turnId`) now triggers translation updates during speech.
- Implemented abort/replace policy per `{sessionId, turnId}` using `AbortController` to avoid backlog.
- Draft emission uses `translate.revise` snapshots with **monotonic** `revision` per turn; throttled while streaming to avoid spam.
- Final emission now uses `translate.revise` (final snapshot) + `translate.final` for a stable end state.
- Debounce/gating: draft translation triggers immediately on meaningful change (≥12 new chars) or after 700ms; otherwise schedules a delayed translate to ensure the latest draft is eventually translated.
- Cleanup: aborts in-flight + clears timers on `client.stop`, idle timeout, and server shutdown.
- Verified: `pnpm -C apps/server typecheck` passes.

