export type Pcm16Frame = {
  pcm16: ArrayBuffer;
  sampleRateHz: number;
  channels: 1;
};

type StartMicStreamerOpts = {
  targetSampleRateHz?: number;
  audioSource: "mic" | "tab" | "both";
  onFrame: (frame: Pcm16Frame) => void;
};

export type MicStreamerHandle = {
  inputSampleRateHz: number;
  outputSampleRateHz: number;
  stop: () => Promise<void>;
};

import workletModuleUrl from "./pcm16ResampleWorklet.js?url";

export async function startMicStreamer(opts: StartMicStreamerOpts): Promise<MicStreamerHandle> {
  const targetSampleRateHz = opts.targetSampleRateHz ?? 16000;

  const mediaStreams: MediaStream[] = [];
  if (opts.audioSource === "mic" || opts.audioSource === "both") {
    mediaStreams.push(await navigator.mediaDevices.getUserMedia({ audio: true }));
  }
  if (opts.audioSource === "tab" || opts.audioSource === "both") {
    if (!navigator.mediaDevices.getDisplayMedia) {
      throw new Error("Browser tab/system audio capture is not supported.");
    }
    const displayStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true });
    if (displayStream.getAudioTracks().length === 0) {
      for (const track of displayStream.getTracks()) track.stop();
      if (opts.audioSource === "both") {
        // Fall back to mic-only if screen/tab audio isn't available (e.g., Safari).
      } else {
        throw new Error(
          "No audio track found. Choose a tab with audio and enable 'Share audio', or switch to Mic.",
        );
      }
    } else {
      mediaStreams.push(displayStream);
    }
  }
  if (mediaStreams.length === 0) {
    throw new Error("No audio source selected.");
  }

  let audioCtx: AudioContext;
  try {
    audioCtx = new AudioContext({ sampleRate: targetSampleRateHz });
  } catch {
    // Some browsers may reject non-default sampleRate; we resample in the worklet anyway.
    audioCtx = new AudioContext();
  }
  const workletUrl = workletModuleUrl;
  try {
    const res = await fetch(workletUrl, { credentials: "include" });
    void res;
  } catch (err) {
    void err;
  }
  try {
    await audioCtx.audioWorklet.addModule(workletUrl);
  } catch (err) {
    throw err;
  }

  const sources = mediaStreams.map((stream) => audioCtx.createMediaStreamSource(stream));
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

  for (const source of sources) {
    source.connect(worklet);
  }
  worklet.connect(mute);
  mute.connect(audioCtx.destination);

  if (audioCtx.state !== "running") await audioCtx.resume();

  const stop = async () => {
    try {
      worklet.port.onmessage = null;
      for (const source of sources) {
        try {
          source.disconnect();
        } catch {
          // ignore
        }
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
      for (const stream of mediaStreams) {
        for (const track of stream.getTracks()) track.stop();
      }
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

