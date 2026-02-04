export type Pcm16Frame = {
  pcm16: ArrayBuffer;
  sampleRateHz: number;
  channels: 1;
};

type StartMicStreamerOpts = {
  targetSampleRateHz?: number;
  onFrame: (frame: Pcm16Frame) => void;
};

export type MicStreamerHandle = {
  inputSampleRateHz: number;
  outputSampleRateHz: number;
  stop: () => Promise<void>;
};

export async function startMicStreamer(opts: StartMicStreamerOpts): Promise<MicStreamerHandle> {
  const targetSampleRateHz = opts.targetSampleRateHz ?? 16000;

  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  let audioCtx: AudioContext;
  try {
    audioCtx = new AudioContext({ sampleRate: targetSampleRateHz });
  } catch {
    // Some browsers may reject non-default sampleRate; we resample in the worklet anyway.
    audioCtx = new AudioContext();
  }
  await audioCtx.audioWorklet.addModule(
    new URL("./pcm16ResampleWorklet.ts", import.meta.url),
  );

  const source = audioCtx.createMediaStreamSource(mediaStream);
  const worklet = new AudioWorkletNode(audioCtx, "pcm16-resample", {
    processorOptions: { targetSampleRate: targetSampleRateHz },
  });

  worklet.port.onmessage = (ev: MessageEvent) => {
    const data = ev.data as unknown;
    if (
      typeof data === "object" &&
      data !== null &&
      "type" in data &&
      (data as { type?: unknown }).type === "pcm16.frame"
    ) {
      const msg = data as {
        pcm16?: unknown;
        sampleRateHz?: unknown;
        channels?: unknown;
      };
      if (!(msg.pcm16 instanceof ArrayBuffer)) return;
      if (typeof msg.sampleRateHz !== "number") return;
      opts.onFrame({ pcm16: msg.pcm16, sampleRateHz: msg.sampleRateHz, channels: 1 });
    }
  };

  // Keep the worklet alive without audible playback.
  const mute = audioCtx.createGain();
  mute.gain.value = 0;

  source.connect(worklet);
  worklet.connect(mute);
  mute.connect(audioCtx.destination);

  if (audioCtx.state !== "running") await audioCtx.resume();

  const stop = async () => {
    try {
      worklet.port.onmessage = null;
      try {
        source.disconnect();
      } catch {
        // ignore
      }
      try {
        worklet.disconnect();
      } catch {
        // ignore
      }
      try {
        mute.disconnect();
      } catch {
        // ignore
      }
      for (const track of mediaStream.getTracks()) track.stop();
      await audioCtx.close();
    } catch {
      // best-effort cleanup
    }
  };

  return {
    inputSampleRateHz: audioCtx.sampleRate,
    outputSampleRateHz: targetSampleRateHz,
    stop,
  };
}

