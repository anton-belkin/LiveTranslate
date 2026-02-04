# DEL-20260204-1905-Agent_B-mic-24khz-to-reduce-resampling (status: cancelled)

## Task
- **Agent**: Agent_B
- **Goal**: Reduce audio distortion risk by outputting 24 kHz PCM16 from the browser, matching OpenAI Realtime required input rate.
- **Milestone**: M1 polish (audio pipeline)

## Scope / constraints
- **Allowed paths**: `apps/web/**`
- **Forbidden**:
  - do not edit `packages/shared/**`
  - do not change server code

## Requirements
- Currently the web worklet targets 16 kHz, and the server resamples to 24 kHz.
- Update mic pipeline to target **24 kHz** output:
  - `startMicStreamer({ targetSampleRateHz: 24000, ... })`
  - ensure AudioWorklet processor uses `targetSampleRate` 24000
  - ensure frames remain ~20ms (at 24kHz that’s ~480 samples per frame)
- Keep compatibility if browser rejects non-default AudioContext rate (worklet already resamples from `sampleRate`).
- Ensure the `audio.frame.sampleRateHz` reflects 24000.

## Gatekeeper note (2026-02-04)
Cancelled: switching to rolling-window/running-total interim transcription makes this less relevant; revisit later if needed.

## Acceptance checklist
- UI still streams frames; server receives `sampleRateHz: 24000`.
- No noticeable CPU regression on a typical laptop (best-effort observation).
- `pnpm -C apps/web typecheck` passes.

## Dependencies / context
- `apps/web/src/audio/micStreamer.ts`
- `apps/web/src/audio/pcm16ResampleWorklet.ts`
- `apps/web/src/ui/App.tsx` startMicStreamer call

## Completion report (agent appends)
<!-- Agent appends below. -->

