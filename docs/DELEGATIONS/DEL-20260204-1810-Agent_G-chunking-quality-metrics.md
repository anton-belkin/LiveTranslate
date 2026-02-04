# DEL-20260204-1810-Agent_G-chunking-quality-metrics (status: completed)

## Task
- **Agent**: Agent_G
- **Goal**: Add simple “chunking quality” metrics to quantify sentence chopping and garbage output.
- **Milestone**: M1 polish (metrics)

## Scope / constraints
- **Allowed paths**: `apps/web/**` (preferred)
- **Forbidden**: do not edit `packages/shared/**`

## Requirements
Add dev-only metrics such as:
- segments per turn (avg, max)\n+- average segment length (chars)\n+- percent of non-latin characters (rough heuristic) per segment/turn\n+- number of very short segments (<3 chars)\n+
Display in the existing “Dev: STT latency metrics” panel or a sibling panel.\n+
## Acceptance checklist
- Metrics visible and easy to interpret.\n+- Helps confirm improvements after Agent_D/F changes.\n+- `pnpm -C apps/web typecheck` passes.

## Dependencies / context
- Existing metrics work: `apps/web/src/ui/App.tsx`
- Turn/segment state: `apps/web/src/ui/liveTranslate/store.ts`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Completion report — Agent_G
- Added a **dev-only** “chunking quality metrics” panel (sibling to latency panel) to quantify:
  - segments per turn (avg/max)
  - average segment length (chars)
  - count of very short segments (<3 chars)
  - rough non‑Latin character % (avg/max) per **segment** and per **turn**
- Metrics update on the existing 500ms UI tick to avoid per-partial render overhead.

### Files changed
- `apps/web/src/ui/App.tsx`
- `docs/DELEGATIONS/DEL-20260204-1810-Agent_G-chunking-quality-metrics.md`

### How to test
- `pnpm -C apps/web typecheck`
- Run: `pnpm -C apps/web dev`
- Speak, then expand **Dev: chunking quality metrics** and observe values changing as segments/turns accumulate.

### Known issues / follow-ups
- Non‑Latin heuristic is intentionally rough (counts code points > U+024F); treat as a “garbage detector”, not language detection.

