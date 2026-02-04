# DEL-20260204-2005-Agent_F-turn-language-column-placement (status: completed)

## Task
- **Agent**: Agent_F
- **Goal**: Place the entire turn into the correct column based on turn language (not per-segment), and allow the turn to jump columns if `lang` updates.
- **Milestone**: M2a (language placement groundwork)

## Scope / constraints
- **Allowed paths**: `apps/web/**`
- **Forbidden**:
  - do not edit `packages/shared/**`
  - do not implement translation yet (rendering stays stubbed)

## Requirements
- Update store to track `turn.lang?: "de" | "en"` (derived from incoming `stt.*.lang` where `segmentId === turnId`).
- Stop defaulting missing STT language to `"de"` (currently `msg.lang ?? "de"`). Treat missing as “unknown”.
- Update `TurnBlock` rendering:
  - if `turn.lang==="de"` show original paragraph in DE column
  - if `turn.lang==="en"` show original paragraph in EN column
  - if unknown, pick a fallback (e.g. keep showing in left) but be ready to move once lang arrives.
- Ensure a lang flip moves the whole turn (no scatter across columns).

## Acceptance checklist
- English speech shows in the right column once `lang:"en"` starts arriving.
- German speech shows in left.
- Turn can jump if server flips lang (acceptable).
- `pnpm -C apps/web typecheck` passes.

## Dependencies / context
- `apps/web/src/ui/liveTranslate/store.ts`
- `apps/web/src/ui/liveTranslate/TurnBlock.tsx`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Completion report (Agent_F)
- **What I changed**
  - Added `turn.lang?: "de" | "en"` to UI state, derived from `stt.*.lang` when `segmentId === turnId`.
  - Stopped defaulting missing STT language to `"de"` at ingest; missing stays unknown until provided.
  - Updated rendering so the entire turn is placed into a single column based on `turn.lang` (with left-column fallback while unknown). If `turn.lang` flips later, the turn moves as a whole.
  - Updated dev mock to use `segmentId === turnId` so column placement can be exercised locally.
- **Files changed**
  - `apps/web/src/ui/liveTranslate/store.ts`
  - `apps/web/src/ui/liveTranslate/TurnBlock.tsx`
  - `apps/web/src/ui/App.tsx`
- **How to test**
  - Commands:
    - `pnpm -C apps/web dev`
    - `pnpm -C apps/web typecheck`
  - Manual:
    - Click `Dev: start mock` and verify:
      - German turns render in left column.
      - English turns render in right column.
      - If `turn.lang` changes, the whole turn shifts columns (no scatter).
- **Known issues / follow-ups**
  - None identified for this scope.

