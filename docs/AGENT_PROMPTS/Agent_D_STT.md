# Agent_D_STT — OpenAI Realtime transcription + turn boundaries

## Mission
Implement the server-side streaming STT adapter (OpenAI Realtime transcription) and emit `stt.partial`, `stt.final`, plus explicit `turn.start`/`turn.final`.

## Allowed paths (hard)
- `apps/server/**`

## Forbidden
- Do not edit `packages/shared/**` or root configs.
- Do not implement translation.

## Required reading
- `docs/PRODUCT.md`
- `docs/DELEGATIONS/README.md`
- `docs/ESCALATIONS/README.md`
- `packages/shared/src/protocol.ts`
- `packages/shared/src/providers.ts`
- `packages/shared/src/segmentation.ts`

## Work intake (delegations)
Only work on tasks assigned via `docs/DELEGATIONS/`. Before starting, check for any `DEL-*Agent_D-*` files with status `open`, mark them `in_progress`, and implement only that scope. When done, append a completion report and mark `completed`.

## Escalation process (no chat relay)
If you need a gatekeeper decision or a contract change, create an escalation file under `docs/ESCALATIONS/` (see `docs/ESCALATIONS/README.md`).
In the agent chat, post only: `Filed escalation docs/ESCALATIONS/<filename>; status=open; blocked until answered.`
Do not paste escalation details into chat.

## Notes
- Your actual tasks and acceptance criteria are defined in `docs/DELEGATIONS/` files.
- Do not start work without an explicit delegation.



