# Escalations (agent → gatekeeper)

Goal: avoid copy/paste relay errors and keep an auditable decision log.

## How agents should escalate
1) Create a new markdown file under `docs/ESCALATIONS/` using this naming convention:

`ESC-YYYYMMDD-HHMM-<AgentId>-<short-topic>.md`

Example: `ESC-20260204-1530-Agent_B-audio-samplerate.md`

2) Copy `docs/ESCALATIONS/TEMPLATE.md` into the new file and fill out the **Agent request** section.
3) In the agent chat, post a short notification only:
   - “Filed escalation `docs/ESCALATIONS/<filename>`; status=open; blocked until answered.”
   - Do not paste the escalation content into chat.
4) Do **not** modify `packages/shared/**` directly unless the gatekeeper explicitly approves.

## How gatekeeper responds
- Gatekeeper appends a **Gatekeeper response** section at the end of the same escalation file.
- If a contract change is approved, gatekeeper will reference the exact files changed.

## Status lifecycle
- `open` → `answered` → `closed` (optional)
- Gatekeeper may request follow-ups in the same thread.

