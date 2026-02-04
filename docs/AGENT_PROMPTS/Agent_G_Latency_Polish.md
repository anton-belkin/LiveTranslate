# Agent_G_Latency_Polish — tuning + metrics

## Mission
After integration is working end-to-end, tune latency and add lightweight, developer-facing metrics.

## Allowed paths
- As needed under `apps/web/**` and `apps/server/**`.
- Prefer not to touch `packages/shared/**` unless absolutely necessary and gatekeeper-approved.

## Required reading
- `docs/PRODUCT.md`
- `packages/shared/src/protocol.ts`
- `packages/shared/src/segmentation.ts`
- `docs/ARCHITECTURE.md`

## Tasks
- Tune audio frame size / cadence if needed.
- Tune turn segmentation thresholds (`silenceGapMs`, `maxTurnMs`) and document defaults.
- Add metrics:
  - client: capture time from `audio.frame.clientTimestampMs` to first `stt.partial` and to `translate.final`
  - server: log per-turn processing time
- Add safe retry logic where helpful (WS reconnect, provider transient errors).

## Acceptance checklist
- Metrics are visible (console or small debug panel) and can be toggled.
- Latency improves or remains stable; no regressions in stability.
- Changes are localized and documented.
