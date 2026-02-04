# DEL-20260204-1910-Agent_G-artifact-metrics (status: cancelled)

## Task
- **Agent**: Agent_G
- **Goal**: Quantify artifact frequency so we can compare tuning attempts objectively.
- **Milestone**: M1 polish (metrics)

## Scope / constraints
- **Allowed paths**: `apps/web/**`
- **Forbidden**: do not edit `packages/shared/**`

## Requirements
Add dev-only metrics:
- count of turns containing any “non‑Latin” characters (using existing heuristic)
- total count of non‑Latin characters seen
- percent of turns with non‑Latin chars
- optionally, show last offending snippet (trimmed) for debugging

Display in the existing metrics panel section(s).

## Gatekeeper note (2026-02-04)
Cancelled: superseded by rolling-window approach tasks; re-open if we need additional metrics.

## Acceptance checklist
- Metrics visible and easy to interpret.
- Helps compare before/after of `STT_STRIP_NON_LATIN` and commit tuning.
- `pnpm -C apps/web typecheck` passes.

## Dependencies / context
- `apps/web/src/ui/App.tsx` metrics sections
- `apps/web/src/ui/liveTranslate/store.ts`

## Completion report (agent appends)
<!-- Agent appends below. -->

