import WebSocket from "ws";
import type { ServerToClientMessage } from "@livetranslate/shared";
import {
  DEFAULT_SEGMENTATION_TUNING,
  type SegmentationTuning,
} from "@livetranslate/shared";
import { uint8ArrayToBase64 } from "../util/base64.js";
import { resamplePcm16MonoLinear } from "./resamplePcm16.js";

const OPENAI_REALTIME_URL = "wss://api.openai.com/v1/realtime?model=gpt-realtime";
const OPENAI_INPUT_SAMPLE_RATE_HZ = 24_000 as const;

type Emit = (msg: ServerToClientMessage) => void;

type ItemTiming = {
  startMs?: number;
  endMs?: number;
};

type AdapterState = "idle" | "connecting" | "open" | "stopping" | "stopped";

export class OpenAIRealtimeTranscriptionAdapter {
  private state: AdapterState = "idle";
  private ws: WebSocket | null = null;
  private readonly sessionId: string;
  private readonly emit: Emit;
  private readonly onError: (err: Error) => void;
  private readonly tuning: SegmentationTuning;
  private readonly transcriptionModel: string;

  private audioQueue: Array<{ msg: string; approxBytes: number }> = [];
  private queuedBytes = 0;
  private readonly maxQueuedBytes = 2 * 1024 * 1024; // 2MB

  private partialTextByItemId = new Map<string, string>();
  private timingsByItemId = new Map<string, ItemTiming>();
  private openTurns = new Set<string>();
  private maxTurnTimersByItemId = new Map<string, NodeJS.Timeout>();

  constructor(args: {
    sessionId: string;
    emit: Emit;
    onError: (err: Error) => void;
    tuning?: Partial<SegmentationTuning>;
    transcriptionModel?: string;
  }) {
    this.sessionId = args.sessionId;
    this.emit = args.emit;
    this.onError = args.onError;
    this.tuning = { ...DEFAULT_SEGMENTATION_TUNING, ...(args.tuning ?? {}) };
    this.transcriptionModel =
      args.transcriptionModel ??
      process.env.OPENAI_TRANSCRIPTION_MODEL ??
      "gpt-4o-mini-transcribe";
  }

  start() {
    if (this.state !== "idle") return;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.state = "stopped";
      this.onError(new Error("OPENAI_API_KEY is not set"));
      return;
    }

    this.state = "connecting";

    const ws = new WebSocket(OPENAI_REALTIME_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this.state = "open";

      // Configure a transcription-only session.
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            type: "transcription",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: OPENAI_INPUT_SAMPLE_RATE_HZ },
                transcription: {
                  model: this.transcriptionModel,
                },
                // Provider VAD boundaries are helpful; we tune silence gap to match shared defaults.
                turn_detection: {
                  type: "server_vad",
                  silence_duration_ms: this.tuning.silenceGapMs,
                  // Keep these conservative; callers can tune later.
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  // For transcription-only, ensure we don't create model responses.
                  create_response: false,
                  interrupt_response: false,
                },
              },
            },
          },
        }),
      );

      this.flushQueue();
    });

    ws.on("message", (data) => {
      try {
        const text = data.toString();
        const evt = JSON.parse(text) as { type?: string };
        this.handleOpenAiEvent(evt);
      } catch (err) {
        this.onError(
          err instanceof Error ? err : new Error("Failed to parse OpenAI event"),
        );
      }
    });

    ws.on("error", (err) => {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    });

    ws.on("close", () => {
      this.state = "stopped";
      this.ws = null;
      this.clearAllTimers();
    });
  }

  pushAudioFrame(args: { pcm16: Uint8Array; sampleRateHz: number }) {
    if (this.state === "stopping" || this.state === "stopped") return;

    // Convert raw bytes to samples. Incoming bytes are PCM16 little-endian.
    const samples = new Int16Array(
      args.pcm16.buffer,
      args.pcm16.byteOffset,
      Math.floor(args.pcm16.byteLength / 2),
    );
    const resampled = resamplePcm16MonoLinear({
      input: samples,
      inSampleRateHz: args.sampleRateHz,
      outSampleRateHz: OPENAI_INPUT_SAMPLE_RATE_HZ,
    });
    const bytes = new Uint8Array(
      resampled.buffer,
      resampled.byteOffset,
      resampled.byteLength,
    );
    const b64 = uint8ArrayToBase64(bytes);

    const msg = JSON.stringify({
      type: "input_audio_buffer.append",
      audio: b64,
    });

    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Backpressure: if we're falling behind, drop newest frames.
      if (ws.bufferedAmount > this.maxQueuedBytes) return;
      ws.send(msg);
      return;
    }

    // Queue while connecting.
    const approxBytes = bytes.byteLength;
    if (this.queuedBytes + approxBytes > this.maxQueuedBytes) {
      // Drop newest if queue is full.
      return;
    }
    this.audioQueue.push({ msg, approxBytes });
    this.queuedBytes += approxBytes;
  }

  async stop(args?: { reason?: string }) {
    if (this.state === "stopped") return;
    this.state = "stopping";
    this.clearAllTimers();

    // Flush any open turns that never completed.
    for (const itemId of this.openTurns) {
      const timing = this.timingsByItemId.get(itemId);
      const startMs = timing?.startMs ?? 0;
      const endMs = timing?.endMs ?? startMs;
      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId: itemId,
        startMs,
        endMs,
      });
    }
    this.openTurns.clear();

    const ws = this.ws;
    this.ws = null;
    this.audioQueue = [];
    this.queuedBytes = 0;
    if (!ws) {
      this.state = "stopped";
      return;
    }

    try {
      ws.close(1000, args?.reason ?? "client_stop");
    } catch {
      // ignore
    }
  }

  private flushQueue() {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    while (this.audioQueue.length > 0) {
      const next = this.audioQueue.shift();
      if (!next) break;
      ws.send(next.msg);
      this.queuedBytes = Math.max(0, this.queuedBytes - next.approxBytes);
    }
  }

  private handleOpenAiEvent(evt: any) {
    const type = evt?.type as string | undefined;
    if (!type) return;

    if (type === "error") {
      const message =
        evt?.error?.message ??
        evt?.error?.code ??
        "OpenAI realtime returned error";
      this.onError(new Error(message));
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      const itemId = String(evt.item_id ?? "");
      const startMs = Number(evt.audio_start_ms ?? 0);
      if (!itemId) return;

      this.timingsByItemId.set(itemId, { startMs });
      this.partialTextByItemId.set(itemId, "");

      if (!this.openTurns.has(itemId)) {
        this.openTurns.add(itemId);
        this.emit({
          type: "turn.start",
          sessionId: this.sessionId,
          turnId: itemId,
          startMs,
        });
      }

      // Force a boundary for very long speech: commit the buffer.
      const existing = this.maxTurnTimersByItemId.get(itemId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }, this.tuning.maxTurnMs);
      this.maxTurnTimersByItemId.set(itemId, t);

      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      const itemId = String(evt.item_id ?? "");
      const endMs = Number(evt.audio_end_ms ?? 0);
      if (!itemId) return;
      const timing = this.timingsByItemId.get(itemId) ?? {};
      timing.endMs = endMs;
      this.timingsByItemId.set(itemId, timing);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.delta") {
      const itemId = String(evt.item_id ?? "");
      const delta = String(evt.delta ?? "");
      if (!itemId) return;

      const existing = this.partialTextByItemId.get(itemId) ?? "";
      const nextText = existing + delta;
      this.partialTextByItemId.set(itemId, nextText);

      const timing = this.timingsByItemId.get(itemId) ?? {};
      const startMs = timing.startMs ?? 0;
      this.emit({
        type: "stt.partial",
        sessionId: this.sessionId,
        turnId: itemId,
        segmentId: itemId,
        text: nextText,
        startMs,
      });
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const itemId = String(evt.item_id ?? "");
      const transcript = String(evt.transcript ?? "");
      if (!itemId) return;

      const timing = this.timingsByItemId.get(itemId) ?? {};
      const startMs = timing.startMs ?? 0;
      const endMs = timing.endMs ?? startMs;

      this.emit({
        type: "stt.final",
        sessionId: this.sessionId,
        turnId: itemId,
        segmentId: itemId,
        text: transcript,
        startMs,
        endMs,
      });

      // Ensure turn finalization happens after STT final.
      if (this.openTurns.has(itemId)) {
        this.emit({
          type: "turn.final",
          sessionId: this.sessionId,
          turnId: itemId,
          startMs,
          endMs,
        });
        this.openTurns.delete(itemId);
      }

      const timer = this.maxTurnTimersByItemId.get(itemId);
      if (timer) clearTimeout(timer);
      this.maxTurnTimersByItemId.delete(itemId);

      this.partialTextByItemId.delete(itemId);
      this.timingsByItemId.delete(itemId);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.failed") {
      const message =
        evt?.error?.message ?? "OpenAI input transcription failed";
      this.onError(new Error(message));
      return;
    }
  }

  private clearAllTimers() {
    for (const t of this.maxTurnTimersByItemId.values()) clearTimeout(t);
    this.maxTurnTimersByItemId.clear();
  }
}

