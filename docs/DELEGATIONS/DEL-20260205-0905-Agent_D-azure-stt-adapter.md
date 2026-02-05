# DEL-20260205-0905-Agent_D-azure-stt-adapter (status: open)

## Task
- **Agent**: Agent_D
- **Goal**: Implement an Azure Speech STT provider adapter.
- **Milestone**: M2 STT provider refactor

## Scope / constraints
- **Allowed paths**: `apps/server/**`
- **Forbidden**: `apps/web/**`
- **Do not change**: `packages/shared/**` unless escalated

## Requirements
- Add an Azure STT provider that implements `SttProvider`.
- Keep OpenAI STT as the default unless configured otherwise.
- Use env-driven configuration (see Azure docs).

## Acceptance checklist
- Azure provider compiles in `apps/server` build.
- Provider selection is explicit and documented.
- No changes to shared contracts without escalation.

## Dependencies / context
- `docs/AGENT_PROMPTS/Agent_D_STT.md`
- `docs/AGENT_PROMPTS/Agent_C_ServerWS.md`
- `docs/INTEGRATIONS/AzureSpeech.md`
- Worktree: `../LiveTranslate-worktrees/backend`

## Completion report (agent appends)
<!-- Agent appends below. -->

