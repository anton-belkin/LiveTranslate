# DEL-20260204-1710-Agent_G-metrics-stt-latency (status: completed)

## Task
- **Agent**: Agent_G
- **Goal**: Add simple metrics to verify “words appear while speaking” improvements and detect regressions.
- **Milestone**: M1 polish (latency metrics)

## Scope / constraints
- **Allowed paths**: `apps/web/**` and/or `apps/server/**` as needed
- **Forbidden**: do not edit `packages/shared/**`

## Requirements
- Capture a client-side timestamp on audio frames (already sent as `audio.frame.clientTimestampMs`).
- Add developer-facing metrics (console or small UI panel) such as:
  - time to first `stt.partial` after “Start mic”
  - rolling estimate: `now - lastClientTimestampMsSent` vs time receiving `stt.partial`
- Keep it low effort; accuracy can be approximate.

## Acceptance checklist
- Metrics visible and easy to interpret.
- No impact on core UI performance.
- `pnpm typecheck` passes.

## Dependencies / context
- Web: `apps/web/src/ui/App.tsx` (audio send loop already sets `clientTimestampMs`)
- UI store already receives `stt.partial`/`stt.final`

## Completion report (agent appends)
<!-- Agent appends below. -->

## Completion report — Agent_G
- Added a small **dev-only** “STT latency metrics” panel to track:
  - time from **Start mic click → first `stt.partial`**
  - rolling “audio age” estimates using `now - lastClientTimestampMsSent`
  - partial count + audio age at last `stt.partial` receive
- Metrics use refs + a 500ms UI tick to avoid re-render churn on every partial; first partial logs to console once.

### Files changed
- `apps/web/src/ui/App.tsx`

### How to test
- `pnpm typecheck`
- Run web dev server (already in your terminal): `pnpm -C apps/web dev`
- Open the app, click **Connect**, then **Start mic**, speak continuously.
- Expand **Dev: STT latency metrics** and observe “Time to first stt.partial” and audio age values.

### Known issues / follow-ups
- Metrics are approximate by design (client clock only) and intended for regression detection, not absolute end-to-end measurement.

