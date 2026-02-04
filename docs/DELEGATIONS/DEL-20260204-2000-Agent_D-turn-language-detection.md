# DEL-20260204-2000-Agent_D-turn-language-detection (status: completed)

## Task
- **Agent**: Agent_D
- **Goal**: Emit a stable `lang` for the stitched STT segment (`segmentId=turnId`) so the UI can place the whole turn in the correct column.
- **Milestone**: M2a (language placement groundwork; still no translation)

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**:
  - do not edit `packages/shared/**` (so only `de/en` for now)
  - do not implement translation yet

## Requirements
- For each rolling-window transcription result (draft + final), determine language:
  - Prefer getting language from the STT API response (request metadata if available).
  - If metadata not available, do lightweight text-based detection between `de` and `en` (best-effort).
- Emit `stt.partial` / `stt.final` with:
  - `turnId=<turnId>`
  - `segmentId=<turnId>`
  - `lang` set to `"de"` or `"en"` when confident.
- Stability / hysteresis:
  - Don’t flip `lang` on tiny texts. Require e.g. >= 30 characters.
  - Only change `lang` if the new language is detected in 2 consecutive ticks (or similar).
  - It’s OK if a turn “jumps” columns once; avoid oscillation.
- No protocol changes.

## Acceptance checklist
- Speaking English results in `lang: "en"` on `stt.*` within a couple updates.
- Speaking German results in `lang: "de"`.
- Code-switching mid-turn can flip `lang` once (acceptable).
- `pnpm -C apps/server typecheck` passes.

## Dependencies / context
- STT code:
  - `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`
  - `apps/server/src/stt/openaiAudioTranscribe.ts`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Agent completion report (2026-02-04)
- **What I changed**
  - Added best-effort **DE/EN language detection** for rolling-window interim STT.
  - Prefer **API-provided language** when available (requests `response_format=verbose_json`), otherwise fall back to a lightweight text heuristic.
  - Added stability/hysteresis:
    - require at least ~30 chars before considering language changes
    - require the new language to be detected **2 consecutive ticks** before flipping
  - Emitted `lang` on `stt.partial` / `stt.final` (with `segmentId=turnId`) when confident.
- **Files changed**
  - `apps/server/src/stt/openaiAudioTranscribe.ts`
  - `apps/server/src/stt/openaiRealtimeTranscriptionAdapter.ts`
  - `docs/DELEGATIONS/DEL-20260204-2000-Agent_D-turn-language-detection.md`
- **How to test**
  - `OPENAI_API_KEY=... pnpm -C apps/server dev`
  - Speak English for a few seconds: expect `stt.partial.lang === "en"` within a couple updates.
  - Speak German for a few seconds: expect `stt.partial.lang === "de"`.
  - `pnpm -C apps/server typecheck`
- **Known issues / follow-ups**
  - **Low**: Heuristic fallback is intentionally simple; if meetings are strongly code-switched, confidence may remain unset (lang omitted) rather than oscillate.

