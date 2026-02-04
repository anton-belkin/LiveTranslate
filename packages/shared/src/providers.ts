import type { Lang, TimestampMs } from "./protocol.js";

export type SttEvent =
  | {
      kind: "partial";
      turnId: string;
      segmentId: string;
      text: string;
      lang?: Lang;
      startMs: TimestampMs;
    }
  | {
      kind: "final";
      turnId: string;
      segmentId: string;
      text: string;
      lang?: Lang;
      startMs: TimestampMs;
      endMs: TimestampMs;
    };

export interface SttProvider {
  startSession(args: {
    sessionId: string;
    sampleRateHz: number;
    onEvent: (evt: SttEvent) => void;
    onError: (err: Error) => void;
  }): Promise<void>;

  pushAudioFrame(args: {
    sessionId: string;
    /**
     * Raw PCM16 little-endian bytes, mono.
     */
    pcm16: Uint8Array;
  }): void;

  stopSession(args: { sessionId: string; reason?: string }): Promise<void>;
}

export interface TranslateProvider {
  /**
   * Stream a translation for a single finalized segment.
   *
   * The callback is a delta stream; the caller accumulates it.
   */
  translateStream(args: {
    sessionId: string;
    turnId: string;
    segmentId: string;
    from: Lang;
    to: Lang;
    text: string;
    /**
     * Small optional context window (caller-controlled) to improve consistency.
     */
    context?: Array<{ from: Lang; to: Lang; source: string; translated: string }>;
    onDelta: (textDelta: string) => void;
    onFinal: (fullText: string) => void;
    onError: (err: Error) => void;
  }): Promise<void>;
}

