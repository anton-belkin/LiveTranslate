/**
 * Linear resampler for mono PCM16.
 *
 * - Input/output are little-endian signed 16-bit samples.
 * - This is "good enough" for a PoC; WebAudio should ideally send 24k directly.
 */
export function resamplePcm16MonoLinear(args: {
  input: Int16Array;
  inSampleRateHz: number;
  outSampleRateHz: number;
}): Int16Array {
  const { input, inSampleRateHz, outSampleRateHz } = args;
  if (inSampleRateHz === outSampleRateHz) return input;
  if (input.length === 0) return input;

  const ratio = outSampleRateHz / inSampleRateHz;
  const outLength = Math.max(1, Math.floor(input.length * ratio));
  const out = new Int16Array(outLength);

  for (let i = 0; i < outLength; i++) {
    const srcIndex = i / ratio;
    const i0 = Math.floor(srcIndex);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = srcIndex - i0;

    const s0 = input[i0] ?? 0;
    const s1 = input[i1] ?? s0;
    const sample = s0 + (s1 - s0) * frac;
    // clamp to int16
    const clamped = Math.max(-32768, Math.min(32767, Math.round(sample)));
    out[i] = clamped;
  }

  return out;
}

