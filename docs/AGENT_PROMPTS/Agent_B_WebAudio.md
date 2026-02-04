# Agent_B_WebAudio — Web audio capture + PCM framing

## Mission
Implement browser tab-audio capture and stream audio frames to the server over WebSocket using the shared protocol.

## Allowed paths (hard)
- `apps/web/**`

## Forbidden
- Do not edit `packages/shared/**` or root configs.
- Do not add server code.

## Required reading
- `docs/PRODUCT.md`
- `docs/DELEGATIONS/README.md`
- `docs/ESCALATIONS/README.md`
- `packages/shared/src/protocol.ts`

## Work intake (delegations)
Only work on tasks assigned via `docs/DELEGATIONS/`. Before starting, check for any `DEL-*Agent_B-*` files with status `open`, mark them `in_progress`, and implement only that scope. When done, append a completion report and mark `completed`.

## Escalation process (no chat relay)
If you need a gatekeeper decision or a contract change, create an escalation file under `docs/ESCALATIONS/` (see `docs/ESCALATIONS/README.md`).
In the agent chat, post only: `Filed escalation docs/ESCALATIONS/<filename>; status=open; blocked until answered.`
Do not paste escalation details into chat.

## Notes
- Your actual tasks and acceptance criteria are defined in `docs/DELEGATIONS/` files.
- Do not start work without an explicit delegation.



