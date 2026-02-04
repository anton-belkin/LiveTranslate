import WebSocket from "ws";
import type { ServerToClientMessage } from "@livetranslate/shared";
import {
  DEFAULT_SEGMENTATION_TUNING,
  type SegmentationTuning,
} from "@livetranslate/shared";
import { uint8ArrayToBase64 } from "../util/base64.js";
import { newId } from "../util/id.js";
import { resamplePcm16MonoLinear } from "./resamplePcm16.js";

const DEFAULT_REALTIME_MODEL = "gpt-realtime";
function getRealtimeUrl() {
  const model = process.env.OPENAI_REALTIME_MODEL ?? DEFAULT_REALTIME_MODEL;
  return `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`;
}
const OPENAI_INPUT_SAMPLE_RATE_HZ = 24_000 as const;

type Emit = (msg: ServerToClientMessage) => void;

type ItemTiming = {
  startMs?: number;
  endMs?: number;
};

type SegmentMeta = {
  turnId: string;
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
  private sessionConfigured = false;

  private audioQueue: Array<{ msg: string; approxBytes: number }> = [];
  private queuedBytes = 0;
  private readonly maxQueuedBytes = 2 * 1024 * 1024; // 2MB

  private segmentTextByItemId = new Map<string, string>();
  private timingsByTurnId = new Map<string, ItemTiming>();
  private segmentByItemId = new Map<string, SegmentMeta>();
  private openTurns = new Set<string>(); // turnIds
  private openSegmentsByTurnId = new Map<string, Set<string>>(); // turnId -> itemIds
  private segmentOrderByTurnId = new Map<string, string[]>(); // turnId -> [itemId...]
  private lastEmittedTurnText = new Map<string, string>(); // turnId -> combined text
  private maxTurnTimersByItemId = new Map<string, NodeJS.Timeout>();

  private audioCursorSamples = 0;

  private inSpeech = false;
  private currentTurnId: string | null = null;
  private speechStartMs: number | null = null;
  private speechEndMs: number | null = null;
  private eagerCommitTimer: NodeJS.Timeout | null = null;
  private finalizeTurnTimer: NodeJS.Timeout | null = null;
  private lastCommitAt = 0;
  private eagerCommitNextDueAt = 0;
  private lastCommitAudioCursorMs = 0;

  private audioCursorNowMs() {
    return Math.floor((this.audioCursorSamples * 1000) / OPENAI_INPUT_SAMPLE_RATE_HZ);
  }

  private sanitizeText(text: string) {
    // Strip ASCII control chars except whitespace separators we may want to keep.
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }

  private combineTurnText(turnId: string) {
    const order = this.segmentOrderByTurnId.get(turnId) ?? [];
    const parts: string[] = [];
    for (const itemId of order) {
      const t = this.segmentTextByItemId.get(itemId) ?? "";
      if (!t) continue;
      parts.push(t);
    }
    const combined = parts.join(" ").replace(/\s+/g, " ").trim();
    return this.sanitizeText(combined);
  }

  private emitCombinedPartial(turnId: string) {
    const combined = this.combineTurnText(turnId);
    const prev = this.lastEmittedTurnText.get(turnId) ?? "";
    if (combined === prev) return;
    this.lastEmittedTurnText.set(turnId, combined);

    const timing = this.timingsByTurnId.get(turnId) ?? {};
    const startMs = timing.startMs ?? this.speechStartMs ?? 0;

    this.emit({
      type: "stt.partial",
      sessionId: this.sessionId,
      turnId,
      segmentId: turnId,
      text: combined,
      startMs,
    });
  }

  private emitCombinedFinal(turnId: string, endMs: number) {
    const combined = this.combineTurnText(turnId);
    const timing = this.timingsByTurnId.get(turnId) ?? {};
    const startMs = timing.startMs ?? this.speechStartMs ?? 0;

    this.emit({
      type: "stt.final",
      sessionId: this.sessionId,
      turnId,
      segmentId: turnId,
      text: combined,
      startMs,
      endMs,
    });
  }

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

    const ws = new WebSocket(getRealtimeUrl(), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    this.ws = ws;

    ws.on("open", () => {
      if (this.state === "stopping" || this.state === "stopped") return;
      this.state = "open";
      this.sessionConfigured = false;

      // Configure a transcription-only session.
      ws.send(
        JSON.stringify({
          type: "session.update",
          session: {
            // Important: we keep the session type as `realtime` and enable input
            // audio transcription, while disabling response creation. Some
            // deployments reject switching a realtime session to `transcription`.
            type: "realtime",
            audio: {
              input: {
                format: { type: "audio/pcm", rate: OPENAI_INPUT_SAMPLE_RATE_HZ },
                transcription: { model: this.transcriptionModel },
                // Provider VAD boundaries are helpful; tune to shared defaults.
                turn_detection: {
                  type: "server_vad",
                  silence_duration_ms: this.tuning.silenceGapMs,
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  // Critical: do not create model responses in this PoC.
                  create_response: false,
                  interrupt_response: false,
                },
                noise_reduction: { type: "near_field" },
              },
              // We don't use output audio in this app.
              output: { format: { type: "audio/pcm", rate: OPENAI_INPUT_SAMPLE_RATE_HZ }, voice: "alloy", speed: 1.0 },
            },
          },
        }),
      );
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
      // Ensure session.update has been applied before sending audio.
      if (this.sessionConfigured) {
        // Backpressure: if we're falling behind, drop newest frames.
        if (ws.bufferedAmount > this.maxQueuedBytes) return;
        ws.send(msg);
        this.audioCursorSamples += resampled.length;
        return;
      }
      // fall through to queue while configuring
    }

    // Queue while connecting.
    const approxBytes = bytes.byteLength;
    if (this.queuedBytes + approxBytes > this.maxQueuedBytes) {
      // Drop newest if queue is full.
      return;
    }
    this.audioQueue.push({ msg, approxBytes });
    this.queuedBytes += approxBytes;
    this.audioCursorSamples += resampled.length;
  }

  async stop(args?: { reason?: string }) {
    if (this.state === "stopped") return;
    this.state = "stopping";
    this.clearAllTimers();

    // Flush any open turns that never completed.
    for (const turnId of this.openTurns) {
      const timing = this.timingsByTurnId.get(turnId);
      const startMs = timing?.startMs ?? 0;
      const endMs = timing?.endMs ?? startMs;
      // Best-effort: emit final combined STT before turn.final.
      this.emitCombinedFinal(turnId, endMs);
      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId,
        startMs,
        endMs,
      });
    }
    this.openTurns.clear();
    this.stopEagerCommit();

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

    if (type === "session.updated") {
      this.sessionConfigured = true;
      this.flushQueue();
      return;
    }

    if (type === "error") {
      const message =
        evt?.error?.message ??
        evt?.error?.code ??
        "OpenAI realtime returned error";
      const code = String(evt?.error?.code ?? "");
      const lowerMsg = String(message).toLowerCase();
      const isEmptyCommit =
        code.toLowerCase().includes("empty") || lowerMsg.includes("empty");
      // Expected sometimes when we eagerly commit while buffer is empty.
      if (isEmptyCommit && Date.now() - this.lastCommitAt < 2000) return;

      this.onError(new Error(message));
      return;
    }

    if (type === "input_audio_buffer.speech_started") {
      const itemId = String(evt.item_id ?? "");
      const startMs = Number(evt.audio_start_ms ?? 0);
      if (!itemId) return;

      this.inSpeech = true;
      this.speechStartMs = startMs;
      this.speechEndMs = null;
      this.lastCommitAudioCursorMs = this.audioCursorNowMs();
      this.eagerCommitNextDueAt = Date.now() + 700;

      if (!this.currentTurnId) {
        this.currentTurnId = newId("turn");
      }

      if (!this.timingsByTurnId.has(this.currentTurnId)) {
        this.timingsByTurnId.set(this.currentTurnId, { startMs });
      }

      if (!this.openTurns.has(this.currentTurnId)) {
        this.openTurns.add(this.currentTurnId);
        this.emit({
          type: "turn.start",
          sessionId: this.sessionId,
          turnId: this.currentTurnId,
          startMs,
        });
      }

      this.startEagerCommit();

      // Force a boundary for very long speech: commit the buffer.
      const existing = this.maxTurnTimersByItemId.get(itemId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        this.lastCommitAt = Date.now();
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }, this.tuning.maxTurnMs);
      this.maxTurnTimersByItemId.set(itemId, t);

      return;
    }

    if (type === "input_audio_buffer.speech_stopped") {
      const itemId = String(evt.item_id ?? "");
      const endMs = Number(evt.audio_end_ms ?? 0);
      if (!itemId) return;
      this.inSpeech = false;
      this.speechEndMs = endMs;
      this.stopEagerCommit();

      // Best-effort: commit once more to flush trailing audio for transcription.
      const ws = this.ws;
      if (ws && ws.readyState === WebSocket.OPEN) {
        this.lastCommitAt = Date.now();
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      }

      this.scheduleFinalizeTurn();
      return;
    }

    // Each commit creates a new user audio item which will be transcribed.
    // We map that provider `item_id` to { turnId, segmentId=item_id }.
    if (type === "input_audio_buffer.committed") {
      const itemId = String(evt.item_id ?? "");
      if (!itemId) return;

      // Ensure we have a turn (speech_started may not always be emitted).
      if (!this.currentTurnId) {
        this.currentTurnId = newId("turn");
        const startMs = this.speechStartMs ?? 0;
        this.timingsByTurnId.set(this.currentTurnId, { startMs });
        this.openTurns.add(this.currentTurnId);
        this.emit({
          type: "turn.start",
          sessionId: this.sessionId,
          turnId: this.currentTurnId,
          startMs,
        });
      }

      const turnId = this.currentTurnId;
      this.segmentByItemId.set(itemId, { turnId });
      this.segmentTextByItemId.set(itemId, "");

      const order = this.segmentOrderByTurnId.get(turnId) ?? [];
      order.push(itemId);
      this.segmentOrderByTurnId.set(turnId, order);

      const openSegs = this.openSegmentsByTurnId.get(turnId) ?? new Set<string>();
      openSegs.add(itemId);
      this.openSegmentsByTurnId.set(turnId, openSegs);

      return;
    }

    if (type === "conversation.item.input_audio_transcription.delta") {
      const itemId = String(evt.item_id ?? "");
      const delta = String(evt.delta ?? "");
      if (!itemId) return;

      const seg = this.segmentByItemId.get(itemId);
      if (!seg) return;

      const existing = this.segmentTextByItemId.get(itemId) ?? "";
      const nextText = existing + delta;
      this.segmentTextByItemId.set(itemId, nextText);

      // Stitch into a single UI-facing segment per turn.
      this.emitCombinedPartial(seg.turnId);
      return;
    }

    if (type === "conversation.item.input_audio_transcription.completed") {
      const itemId = String(evt.item_id ?? "");
      const transcript = String(evt.transcript ?? "");
      if (!itemId) return;

      const seg = this.segmentByItemId.get(itemId);
      if (!seg) return;
      this.segmentTextByItemId.set(itemId, transcript);
      // Emit stitched partial after finalizing a sub-segment (keeps UI up to date).
      this.emitCombinedPartial(seg.turnId);

      const timer = this.maxTurnTimersByItemId.get(itemId);
      if (timer) clearTimeout(timer);
      this.maxTurnTimersByItemId.delete(itemId);

      this.segmentByItemId.delete(itemId);

      const openSegs = this.openSegmentsByTurnId.get(seg.turnId);
      if (openSegs) {
        openSegs.delete(itemId);
        if (openSegs.size === 0) this.openSegmentsByTurnId.delete(seg.turnId);
      }

      // If speech already ended, we can finalize once all segments complete.
      if (!this.inSpeech) this.tryFinalizeTurnNow();
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
    this.stopEagerCommit();
    if (this.finalizeTurnTimer) clearTimeout(this.finalizeTurnTimer);
    this.finalizeTurnTimer = null;
  }

  private startEagerCommit() {
    if (this.eagerCommitTimer) return;
    // Adaptive eager commits while in speech so transcription starts during speech,
    // but avoid micro-chunks by requiring a minimum audio duration between commits.
    this.eagerCommitTimer = setInterval(() => {
      if (!this.inSpeech) return;
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!this.sessionConfigured) return;

      const now = Date.now();
      if (now < this.eagerCommitNextDueAt) return;

      const audioMsSinceLastCommit = this.audioCursorNowMs() - this.lastCommitAudioCursorMs;
      if (audioMsSinceLastCommit < 450) {
        // Try again soon; don't advance the due time much.
        this.eagerCommitNextDueAt = now + 150;
        return;
      }

      // Next commit window: 700–1200ms.
      const nextInterval = 700 + Math.floor(Math.random() * 501);
      this.eagerCommitNextDueAt = now + nextInterval;
      this.lastCommitAudioCursorMs = this.audioCursorNowMs();

      this.lastCommitAt = now;
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    }, 120);
  }

  private stopEagerCommit() {
    if (!this.eagerCommitTimer) return;
    clearInterval(this.eagerCommitTimer);
    this.eagerCommitTimer = null;
  }

  private scheduleFinalizeTurn() {
    if (!this.currentTurnId) return;
    if (this.finalizeTurnTimer) clearTimeout(this.finalizeTurnTimer);

    // Give the provider time to emit final transcription events.
    this.finalizeTurnTimer = setTimeout(() => {
      this.tryFinalizeTurnNow();
    }, 1500);
  }

  private tryFinalizeTurnNow() {
    const turnId = this.currentTurnId;
    if (!turnId) return;
    if (this.inSpeech) return;
    const openSegs = this.openSegmentsByTurnId.get(turnId);
    if (openSegs && openSegs.size > 0) return;

    const timing = this.timingsByTurnId.get(turnId) ?? {};
    const startMs = timing.startMs ?? this.speechStartMs ?? 0;
    const endMs =
      this.speechEndMs ??
      this.audioCursorNowMs() ??
      startMs;
    timing.startMs = startMs;
    timing.endMs = endMs;
    this.timingsByTurnId.set(turnId, timing);

    if (this.openTurns.has(turnId)) {
      // Emit a single final stitched segment for the whole turn.
      this.emitCombinedFinal(turnId, endMs);
      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId,
        startMs,
        endMs,
      });
      this.openTurns.delete(turnId);
    }

    this.currentTurnId = null;
    this.speechStartMs = null;
    this.speechEndMs = null;
    this.lastEmittedTurnText.delete(turnId);
    this.segmentOrderByTurnId.delete(turnId);
    this.openSegmentsByTurnId.delete(turnId);

    if (this.finalizeTurnTimer) clearTimeout(this.finalizeTurnTimer);
    this.finalizeTurnTimer = null;
  }
}

