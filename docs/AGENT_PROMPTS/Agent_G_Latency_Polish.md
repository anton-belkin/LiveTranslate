# Agent_G_Latency_Polish — tuning + metrics

## Mission
After integration is working end-to-end, tune latency and add lightweight, developer-facing metrics.

## Allowed paths
- As needed under `apps/web/**` and `apps/server/**`.
- Prefer not to touch `packages/shared/**` unless absolutely necessary and gatekeeper-approved.

## Required reading
- `docs/PRODUCT.md`
- `docs/DELEGATIONS/README.md`
- `docs/ESCALATIONS/README.md`
- `packages/shared/src/protocol.ts`
- `packages/shared/src/segmentation.ts`
- `docs/ARCHITECTURE.md`

## Work intake (delegations)
Only work on tasks assigned via `docs/DELEGATIONS/`. Before starting, check for any `DEL-*Agent_G-*` files with status `open`, mark them `in_progress`, and implement only that scope. When done, append a completion report and mark `completed`.

## Escalation process (no chat relay)
If you need a gatekeeper decision or a contract change, create an escalation file under `docs/ESCALATIONS/` (see `docs/ESCALATIONS/README.md`).
In the agent chat, post only: `Filed escalation docs/ESCALATIONS/<filename>; status=open; blocked until answered.`
Do not paste escalation details into chat.

## Notes
- Your actual tasks and acceptance criteria are defined in `docs/DELEGATIONS/` files.
- Do not start “general polishing” without an explicit delegation.
