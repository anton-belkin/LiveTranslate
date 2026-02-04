# DEL-20260204-2030-Agent_F-render-translation-events (status: completed)

## Task
- **Agent**: Agent_F
- **Goal**: Render server translation events so the opposite column fills in (DE↔EN).
- **Milestone**: M2a (translation UI)

## Scope / constraints
- **Allowed paths**: `apps/web/**`
- **Forbidden**:
  - do not edit `packages/shared/**`
  - keep language support to `de/en` for now

## Requirements
- Currently the server emits `translate.partial` / `translate.final`, but the UI store ignores them.
- Extend UI state to store translation text per turn for the stitched segment:
  - Key by `turnId` (and/or `segmentId` where `segmentId===turnId`).
  - Accumulate `translate.partial.textDelta` into a buffer.
  - On `translate.final.text`, replace buffer with final.
  - Track partial vs final to style the translation similarly to STT.
- Render translation in the opposite column:
  - If `turn.lang === "de"` (original on left), show translation on right.
  - If `turn.lang === "en"` (original on right), show translation on left.
  - If `turn.lang` is unknown, keep current behavior (place original left) and show translation only when available.
- Avoid re-render churn: ignore duplicate deltas/finals when no content change.

## Acceptance checklist
- Speak German: original appears left, English translation streams into right column.
- Speak English: original appears right, German translation streams into left column.
- `pnpm -C apps/web typecheck` passes.

## Dependencies / context
- Protocol events: `packages/shared/src/protocol.ts` (do not edit)
- Store: `apps/web/src/ui/liveTranslate/store.ts`
- Rendering: `apps/web/src/ui/liveTranslate/TurnBlock.tsx`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Completion report (Agent_F)
- **What I changed**
  - Added per-turn translation state for stitched segments (`segmentId === turnId`) and handled `translate.partial` (delta accumulation), `translate.final` (replace with final), and `translate.revise` (replace with revised partial).
  - Rendered translation paragraph in the opposite column based on `turn.lang` (DE→right / EN→left). When `turn.lang` is unknown, original stays left and translation appears on the right once available.
  - Avoided re-render churn by ignoring duplicate `translate.partial` deltas and duplicate finals.
  - Updated dev mock to emit streaming `translate.partial` and `translate.final` events.
- **Files changed**
  - `apps/web/src/ui/liveTranslate/store.ts`
  - `apps/web/src/ui/liveTranslate/TurnBlock.tsx`
  - `apps/web/src/ui/App.tsx`
- **How to test**
  - Commands:
    - `pnpm -C apps/web dev`
    - `pnpm -C apps/web typecheck`
  - Manual:
    - Click `Dev: start mock`
    - Verify:
      - German turns: original streams left; English translation streams right.
      - English turns: original streams right; German translation streams left.
- **Known issues / follow-ups**
  - Store currently ignores translation events where `segmentId !== turnId` (intentionally scoped to stitched mode).

