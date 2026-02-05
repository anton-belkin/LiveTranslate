# DEL-20260205-0900-Agent_F-obs-ui-simplify (status: open)

## Task
- **Agent**: Agent_F
- **Goal**: Simplify the web UI for OBS-friendly captions display.
- **Milestone**: M2 captions polish

## Scope / constraints
- **Allowed paths**: `apps/web/**`
- **Forbidden**: `apps/server/**`
- **Do not change**: `packages/shared/**` unless escalated

## Requirements
- Reduce on-screen controls to the minimum needed for captions.
- Provide a high-contrast, large-text view suitable for OBS.
- Keep existing WebSocket wiring intact.

## Acceptance checklist
- UI renders cleanly in `pnpm -C apps/web dev`.
- Captions remain readable at 720p and 1080p.
- No changes to shared contracts.

## Dependencies / context
- `docs/AGENT_PROMPTS/Agent_F_UI.md`
- `docs/PRODUCT.md`
- Worktree: `../LiveTranslate-worktrees/frontend`

## Completion report (agent appends)
<!-- Agent appends below. -->

