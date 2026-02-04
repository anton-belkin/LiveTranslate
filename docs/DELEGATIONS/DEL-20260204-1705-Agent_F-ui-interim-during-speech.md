# DEL-20260204-1705-Agent_F-ui-interim-during-speech (status: completed)

## Task
- **Agent**: Agent_F
- **Goal**: Ensure interim STT updates render smoothly while speaking (and multiple segments per turn don’t look weird).
- **Milestone**: M1 polish (UI for interim STT)

## Scope / constraints
- **Allowed paths**: `apps/web/**`
- **Forbidden**:
  - do not edit `packages/shared/**`
  - do not implement translation (still stubbed)

## Requirements
- Assume Agent_D will start emitting **more frequent `stt.partial` updates** (during speech).
- Assume multiple `segmentId`s may appear within the same `turnId` due to eager commits.
- UI should:
  - update current turn text without flicker/jank
  - keep turn blocks distinct (no merging)
  - avoid scroll-jank (auto-scroll policy can remain “on new turn only” but must not hide updates)
  - show partial vs final clearly

## Acceptance checklist
- When receiving rapid `stt.partial` updates, UI remains responsive (no noticeable lag for typical meetings).
- Multiple segments within one turn render in a readable way (e.g., as concatenated lines or per-segment display).
- `pnpm -C apps/web typecheck` passes.

## Dependencies / context
- `apps/web/src/ui/liveTranslate/store.ts`
- `apps/web/src/ui/liveTranslate/TranscriptView.tsx`
- `apps/web/src/ui/liveTranslate/TurnBlock.tsx`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Completion report (Agent_F)
- **What I changed**
  - Render segments per-turn as a vertical list (one line per `segmentId`) to keep multiple segments readable.
  - Reduced re-render churn for rapid `stt.partial` updates by ignoring duplicate partials and ignoring partials after a segment is finalized.
  - Added “stick-to-bottom” behavior: if the user is already near the page bottom, partial updates keep the latest text visible; if the user scrolls up, we do not auto-scroll.
- **Files changed**
  - `apps/web/src/ui/liveTranslate/store.ts`
  - `apps/web/src/ui/liveTranslate/TurnBlock.tsx`
  - `apps/web/src/ui/liveTranslate/TranscriptView.tsx`
  - `apps/web/src/ui/styles.css`
- **How to test**
  - Commands:
    - `pnpm -C apps/web dev`
    - `pnpm -C apps/web typecheck`
  - Manual:
    - Click `Dev: start mock` (or connect to a WS server emitting rapid `stt.partial`).
    - Confirm rapid interim updates remain responsive and readable, and scroll stays stable unless you’re already near the bottom.
- **Known issues / follow-ups**
  - Repo lint script still fails due to missing ESLint v9 config (out of this delegation’s scope).

