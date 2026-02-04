# Agent_F_UI — two-column transcript UI

## Mission
Build the browser UI that renders distinct turn blocks and shows original + translated text in two columns (DE/EN) with color-coding and interim/final styling.

## Milestone focus
**Milestone 1 (STT-only)**: implement UI for `turn.*` + `stt.*` first. Translation rendering can be stubbed (e.g., “pending”) until Milestone 2.

## Allowed paths (hard)
- `apps/web/**`

## Forbidden
- Do not edit `packages/shared/**` or root configs.
- Do not implement audio capture (Agent_B owns that) except minimal wiring to display connection status.

## Required reading
- `docs/PRODUCT.md`
- `docs/ESCALATIONS/README.md`
- `packages/shared/src/protocol.ts`

## Escalation process (no chat relay)
If you need a gatekeeper decision or a contract change, create an escalation file under `docs/ESCALATIONS/` (see `docs/ESCALATIONS/README.md`).
In the agent chat, post only: `Filed escalation docs/ESCALATIONS/<filename>; status=open; blocked until answered.`
Do not paste escalation details into chat.

## Requirements
- Establish a WebSocket connection to the server and handle `ServerToClientMessage` events.
- Render:
  - two columns: Deutsch / English
  - **distinct turn blocks** keyed by `turnId` (do not merge turns)
  - original text in the source language column
  - translated text in the other column (Milestone 2; for Milestone 1 show placeholder)
- Styling:
  - color-code original vs translation
  - show partial vs final with subtle differences
- Performance:
  - incremental rendering
  - avoid O(n^2) updates (prepare for long meetings)

## Acceptance checklist
- Consecutive turns appear as separate blocks even when close in time.
- Partial text updates do not cause flicker/jank.
- Works without audio capture running (can render mocked events).

## Local test
- Run web: `pnpm -C apps/web dev`
- Connect to server and render incoming events; optionally add a dev-only mock event generator.
