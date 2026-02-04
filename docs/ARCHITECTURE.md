# Architecture (PoC)

## High-level flow

```mermaid
sequenceDiagram
  participant Browser as Browser_App
  participant Server as WS_Server
  participant STT as Cloud_STT
  participant LLM as Translate_LLM

  Browser->>Server: client.hello
  Browser->>Server: audio.frame (PCM16 mono)
  Server->>STT: stream audio
  STT-->>Server: stt.partial / stt.final
  Server-->>Browser: turn.start / stt.partial
  Server-->>Browser: stt.final / turn.final
  Server->>LLM: translate (DE↔EN)
  LLM-->>Server: translate.partial / translate.final
  Server-->>Browser: translate.partial / translate.final
```

## Design invariants
- **Contracts-first**: `packages/shared` is the source of truth.
- **Low latency**: show `stt.partial` quickly; translation streams as available.
- **Turn separation**: UI renders *distinct* turn blocks; server emits explicit turn boundaries.
- **No secret leakage**: API keys are **server-side only**.

## Repo layout
- `apps/web`: capture tab audio + render transcript UI
- `apps/server`: WebSocket server + STT + translation adapters
- `packages/shared`: protocol + interfaces + segmentation state machine
