# DEL-20260204-2020-Gatekeeper-protocol-multi-lang (status: open)

## Task
- **Agent**: Gatekeeper
- **Goal**: Support user-selectable column languages: EN/DE/IT/FR/RU (protocol + minimal wiring).
- **Milestone**: M2b (multi-language columns)

## Scope / constraints
- **Allowed paths**: `packages/shared/**`, plus minimal wiring in `apps/web/**` and `apps/server/**` as needed
- **Forbidden**:
  - do not implement translation beyond DE/EN until M2a is stable

## Requirements
- Extend `LangSchema` and `Lang` to include: `de`, `en`, `it`, `fr`, `ru`.
- Ensure all zod schemas referencing `LangSchema` remain valid.
- Update UI dropdown(s) to let the user pick `lang1`/`lang2` from that set.
- Ensure `client.hello.langs` is used end-to-end (server stores per-session target languages for translation routing later).

## Acceptance checklist
- Typecheck passes across workspace.
- UI can select column languages without runtime errors.
- Protocol validation accepts the new language codes.

## Dependencies / context
- `packages/shared/src/protocol.ts` (LangSchema)
- `apps/web` currently hardcodes headers “Deutsch/English”; will need to become dynamic.

## Completion report (agent appends)
<!-- Gatekeeper appends below. -->

