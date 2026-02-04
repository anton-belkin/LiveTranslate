# Delegations (gatekeeper → agents)

Goal: reduce chat overhead and keep a durable execution log. The gatekeeper assigns work by creating a delegation file; agents execute only what’s assigned and report completion by appending to the same file.

## Folder layout
- `docs/DELEGATIONS/` — delegation task files live here
- `docs/DELEGATIONS/TEMPLATE.md` — template used for new tasks

## Naming convention
Gatekeeper creates a new markdown file:

`DEL-YYYYMMDD-HHMM-<AgentId>-<short-topic>.md`

Example: `DEL-20260204-1605-Agent_D-stt-interim-flush.md`

## Status lifecycle
Each delegation file should keep a status in the title line:
- `open` → `in_progress` → `completed` (or `cancelled`)

Agents update status by editing the title line only.

## How agents pick up work
1) Check `docs/DELEGATIONS/` for files matching your agent id (or unassigned files if explicitly allowed).
2) Open the newest `open` task for you.
3) Implement changes within the allowed scope.
4) Append a completion report at the bottom.

## Agent completion report (append to same file)
Append a new section:
- What you changed (bullets)
- Files changed
- How to test (exact commands + manual steps)
- Known issues / follow-ups

## Questions / blockers
If you need a gatekeeper decision (contract changes, scope changes, unclear requirements), do **not** ask in chat and do **not** modify `packages/shared/**` directly. File an escalation:
- `docs/ESCALATIONS/` (see `docs/ESCALATIONS/README.md`)

In agent chat, post only:
`Filed escalation docs/ESCALATIONS/<filename>; status=open; blocked until answered.`

## Chat etiquette
Agents may post in chat only:
- “Picked up `docs/DELEGATIONS/<file>`; status=in_progress.”
- “Completed `docs/DELEGATIONS/<file>`; status=completed.”
- escalation filed notice (above)

