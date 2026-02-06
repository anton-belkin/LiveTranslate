# Architecture (PoC)

## High-level flow

```mermaid
sequenceDiagram
  participant Browser as Browser_App
  participant Server as WS_Server
  participant STT as Cloud_STT
  participant LLM as Groq_Translate_LLM

  Browser->>Server: client.hello
  Browser->>Server: audio.frame (PCM16 mono)
  Server->>STT: stream audio (PCM16)
  STT-->>Server: stt.partial / stt.final (with LID)
  Server-->>Browser: turn.start / stt.partial / stt.final / turn.final
  Server->>LLM: translate (N target langs, context + summary)
  LLM-->>Server: translations (+ summary on finals)
  Server-->>Browser: translate.revise/translate.final + summary.update
```

## Design invariants
- **Contracts-first**: `packages/shared` is the source of truth.
- **Low latency**: show `stt.partial` quickly; translation streams as available.
- **Turn separation**: UI renders *distinct* turn blocks; server emits explicit turn boundaries.
- **No secret leakage**: API keys are **server-side only**.
- **Explicit approvals**: any architectural change (data flow, module boundaries, protocols) must be approved by the project owner before merge.

## Runtime configuration
- **Target languages**: set via URL `langs=en,de,ru` (client) and/or `GROQ_TARGET_LANGS` (server default).
- **Original column**: toggle via URL `showOriginal=1|0` and UI toggle.
- **Summary panel**: toggle via URL `showSummary=1|0`.
- **Static context override**: via URL `staticContext=...` (client), overrides server default `GROQ_STATIC_CONTEXT`.

## Translation state (per session)
- **History buffer**: last 10 finalized utterances with original language and translations.
- **Summary**: English discussion summary updated on final utterances only.
- **Partial handling**: partials are translated for low latency but do not mutate summary/history.

## Repo layout
- `apps/web`: capture tab audio + render transcript UI
- `apps/server`: WebSocket server + STT + translation adapters
- `packages/shared`: protocol + interfaces + segmentation state machine
