/* eslint-disable no-restricted-globals */
/**
 * AudioWorklet: mixdown -> resample -> frame into PCM16 chunks.
 *
 * Posts messages: `{ type: "pcm16.frame", pcm16: ArrayBuffer, sampleRateHz: number, channels: 1 }`
 */

type FrameMessage = {
  type: "pcm16.frame";
  pcm16: ArrayBuffer;
  sampleRateHz: number;
  channels: 1;
};

class Pcm16ResampleProcessor extends AudioWorkletProcessor {
  private readonly inputSampleRate: number;
  private readonly outputSampleRate: number;
  private readonly ratio: number; // input / output

  private readonly frameSamples: number;
  private resamplePos = 0; // in input sample units

  private pending: Int16Array;
  private pendingLen = 0;

  constructor(options: any) {
    super();
    this.inputSampleRate = sampleRate;
    const target = (options.processorOptions?.targetSampleRate as number | undefined) ?? 16000;
    this.outputSampleRate = target;
    this.ratio = this.inputSampleRate / this.outputSampleRate;

    this.frameSamples = Math.max(1, Math.round(this.outputSampleRate * 0.02)); // ~20ms
    // Keep some headroom to reduce reallocs; worst-case a process call might output a handful.
    this.pending = new Int16Array(this.frameSamples * 8);
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channels = input.length;
    const frames = input[0]?.length ?? 0;
    if (!frames) return true;

    // Generate output samples by reading at resamplePos steps.
    while (this.resamplePos < frames) {
      const i0 = Math.floor(this.resamplePos);
      const i1 = Math.min(i0 + 1, frames - 1);
      const frac = this.resamplePos - i0;

      let s0 = 0;
      let s1 = 0;
      for (let ch = 0; ch < channels; ch++) {
        const buf = input[ch]!;
        s0 += buf[i0] ?? 0;
        s1 += buf[i1] ?? 0;
      }
      s0 /= channels;
      s1 /= channels;

      const mono = (1 - frac) * s0 + frac * s1;
      const clamped = Math.max(-1, Math.min(1, mono));
      const int16 = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;

      this.pushSample(int16 | 0);

      this.resamplePos += this.ratio;
    }

    this.resamplePos -= frames;
    return true;
  }

  private pushSample(sample: number) {
    if (this.pendingLen >= this.pending.length) {
      const next = new Int16Array(this.pending.length * 2);
      next.set(this.pending);
      this.pending = next;
    }

    this.pending[this.pendingLen++] = sample;

    while (this.pendingLen >= this.frameSamples) {
      const frame = this.pending.subarray(0, this.frameSamples);
      const bytes = frame.buffer.slice(
        frame.byteOffset,
        frame.byteOffset + frame.byteLength,
      ) as ArrayBuffer;

      const msg: FrameMessage = {
        type: "pcm16.frame",
        pcm16: bytes,
        sampleRateHz: this.outputSampleRate,
        channels: 1,
      };
      // Transfer the buffer to reduce copying.
      this.port.postMessage(msg, [bytes]);

      const remaining = this.pendingLen - this.frameSamples;
      if (remaining > 0) this.pending.copyWithin(0, this.frameSamples, this.pendingLen);
      this.pendingLen = remaining;
    }
  }
}

registerProcessor("pcm16-resample", Pcm16ResampleProcessor);

