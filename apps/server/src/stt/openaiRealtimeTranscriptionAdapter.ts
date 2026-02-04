import WebSocket from "ws";
import type { ServerToClientMessage } from "@livetranslate/shared";
import {
  DEFAULT_SEGMENTATION_TUNING,
  type SegmentationTuning,
} from "@livetranslate/shared";
import { uint8ArrayToBase64 } from "../util/base64.js";
import { newId } from "../util/id.js";
import { openaiTranscribeWav } from "./openaiAudioTranscribe.js";
import { resamplePcm16MonoLinear } from "./resamplePcm16.js";
import { pcm16MonoToWavBytes } from "./wav.js";

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

  private timingsByTurnId = new Map<string, ItemTiming>();
  private openTurns = new Set<string>(); // turnIds
  private maxTurnTimersByItemId = new Map<string, NodeJS.Timeout>();

  private audioCursorSamples = 0;

  private currentTurnId: string | null = null;
  private speechStartMs: number | null = null;
  private speechEndMs: number | null = null;
  private inSpeech = false;

  // Rolling-window interim STT (non-realtime transcription endpoint)
  private rollingTimer: NodeJS.Timeout | null = null;
  private rollingInFlight = false;
  private rollingFinalizeQueued = false;
  private turnDraftText = "";

  // Audio buffers (24kHz mono PCM16)
  private preSpeechChunks: Int16Array[] = [];
  private preSpeechSamples = 0;
  private turnChunks: Int16Array[] = [];
  private turnSamples = 0;

  private readonly rollingCfg: {
    maxWindowSeconds: number;
    overlapSeconds: number;
    updateIntervalMs: number;
    stableTailChars: number;
    maxWindowSamples: number;
    overlapSamples: number;
    preSpeechMaxSamples: number;
  };

  private audioCursorNowMs() {
    return Math.floor((this.audioCursorSamples * 1000) / OPENAI_INPUT_SAMPLE_RATE_HZ);
  }

  private sanitizeText(text: string) {
    // Strip ASCII control chars except whitespace separators we may want to keep.
    return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  }

  private stabilizeDraft(prev: string, next: string) {
    const cleanedNext = this.sanitizeText(next).replace(/\s+/g, " ").trim();
    if (!prev) return cleanedNext;

    const lcp = longestCommonPrefixLength(prev, cleanedNext);
    const stableLimit = Math.max(0, prev.length - this.rollingCfg.stableTailChars);
    const stableLen = Math.min(lcp, stableLimit);
    return prev.slice(0, stableLen) + cleanedNext.slice(stableLen);
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

    const maxWindowSeconds = clampNumber(
      Number(process.env.STT_ROLLING_MAX_WINDOW_SECONDS ?? 25),
      5,
      60,
    );
    const overlapSeconds = clampNumber(
      Number(process.env.STT_ROLLING_OVERLAP_SECONDS ?? 1.5),
      0.2,
      5,
    );
    const updateIntervalMs = clampNumber(
      Number(process.env.STT_ROLLING_UPDATE_INTERVAL_MS ?? 1000),
      300,
      5000,
    );
    const stableTailChars = clampNumber(
      Number(process.env.STT_ROLLING_STABLE_TAIL_CHARS ?? 60),
      10,
      200,
    );

    this.rollingCfg = {
      maxWindowSeconds,
      overlapSeconds,
      updateIntervalMs,
      stableTailChars,
      maxWindowSamples: Math.floor(OPENAI_INPUT_SAMPLE_RATE_HZ * maxWindowSeconds),
      overlapSamples: Math.floor(OPENAI_INPUT_SAMPLE_RATE_HZ * overlapSeconds),
      preSpeechMaxSamples: Math.floor(
        OPENAI_INPUT_SAMPLE_RATE_HZ * Math.max(2, overlapSeconds),
      ),
    };
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
        this.appendToPreSpeech(resampled);
        if (this.currentTurnId) {
          this.appendToTurn(resampled);
          this.maybeForceTurnCut();
        }
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
    this.appendToPreSpeech(resampled);
    if (this.currentTurnId) {
      this.appendToTurn(resampled);
      this.maybeForceTurnCut();
    }
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
      // Best-effort: emit final draft STT before turn.final.
      this.emit({
        type: "stt.final",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        text: this.turnDraftText,
        startMs,
        endMs,
      });
      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId,
        startMs,
        endMs,
      });
    }
    this.openTurns.clear();
    this.stopRollingTimer();

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
      this.currentTurnId = newId("turn");
      this.turnDraftText = "";
      this.turnChunks = [];
      this.turnSamples = 0;

      // Seed turn buffer with a small prespeech overlap window.
      const seed = this.snapshotTailSamples(
        this.preSpeechChunks,
        this.preSpeechSamples,
        this.rollingCfg.overlapSamples,
      );
      if (seed.length > 0) this.appendToTurn(seed);

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

      this.startRollingTimer();

      // Force a boundary for very long speech: commit the buffer.
      const existing = this.maxTurnTimersByItemId.get(itemId);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        // If speech continues too long, cut the turn (running-window cap).
        this.forceCutTurn();
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
      this.stopRollingTimer();
      void this.finalizeTurnAsync();
      return;
    }
  }

  private clearAllTimers() {
    for (const t of this.maxTurnTimersByItemId.values()) clearTimeout(t);
    this.maxTurnTimersByItemId.clear();
    this.stopRollingTimer();
  }

  private startRollingTimer() {
    if (this.rollingTimer) return;
    this.rollingTimer = setInterval(() => {
      void this.rollingTick();
    }, this.rollingCfg.updateIntervalMs);
  }

  private stopRollingTimer() {
    if (!this.rollingTimer) return;
    clearInterval(this.rollingTimer);
    this.rollingTimer = null;
  }

  private async rollingTick() {
    if (this.rollingInFlight) return;
    const turnId = this.currentTurnId;
    if (!turnId) return;
    if (!this.inSpeech) return;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    const windowPcm = this.snapshotTailSamples(
      this.turnChunks,
      this.turnSamples,
      this.rollingCfg.maxWindowSamples,
    );
    if (windowPcm.length < Math.floor(OPENAI_INPUT_SAMPLE_RATE_HZ * 0.25)) return;

    this.rollingInFlight = true;
    try {
      const wavBytes = pcm16MonoToWavBytes({
        pcm16: windowPcm,
        sampleRateHz: OPENAI_INPUT_SAMPLE_RATE_HZ,
      });
      const { text } = await openaiTranscribeWav({
        apiKey,
        wavBytes,
        model: this.transcriptionModel,
      });

      // If we rotated turns while request was in flight, ignore.
      if (this.currentTurnId !== turnId) return;

      const nextDraft = this.stabilizeDraft(this.turnDraftText, text);
      this.turnDraftText = nextDraft;

      const timing = this.timingsByTurnId.get(turnId) ?? {};
      const startMs = timing.startMs ?? this.speechStartMs ?? 0;
      this.emit({
        type: "stt.partial",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        text: nextDraft,
        startMs,
      });
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.rollingInFlight = false;
      if (this.rollingFinalizeQueued && !this.inSpeech) {
        this.rollingFinalizeQueued = false;
        void this.finalizeTurnAsync();
      }
    }
  }

  private async finalizeTurnAsync() {
    const turnId = this.currentTurnId;
    if (!turnId) return;
    if (this.rollingInFlight) {
      this.rollingFinalizeQueued = true;
      return;
    }

    const timing = this.timingsByTurnId.get(turnId) ?? {};
    const startMs = timing.startMs ?? this.speechStartMs ?? 0;
    const endMs = this.speechEndMs ?? this.audioCursorNowMs();
    timing.startMs = startMs;
    timing.endMs = endMs;
    this.timingsByTurnId.set(turnId, timing);

    const apiKey = process.env.OPENAI_API_KEY;
    if (apiKey) {
      try {
        const windowPcm = this.snapshotTailSamples(
          this.turnChunks,
          this.turnSamples,
          this.rollingCfg.maxWindowSamples,
        );
        if (windowPcm.length > 0) {
          const wavBytes = pcm16MonoToWavBytes({
            pcm16: windowPcm,
            sampleRateHz: OPENAI_INPUT_SAMPLE_RATE_HZ,
          });
          const { text } = await openaiTranscribeWav({
            apiKey,
            wavBytes,
            model: this.transcriptionModel,
          });
          this.turnDraftText = this.sanitizeText(text).replace(/\s+/g, " ").trim();
        }
      } catch (err) {
        this.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    // Final combined segment.
    this.emit({
      type: "stt.final",
      sessionId: this.sessionId,
      turnId,
      segmentId: turnId,
      text: this.turnDraftText,
      startMs,
      endMs,
    });

    if (this.openTurns.has(turnId)) {
      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId,
        startMs,
        endMs,
      });
      this.openTurns.delete(turnId);
    }

    // Reset turn state.
    this.currentTurnId = null;
    this.speechStartMs = null;
    this.speechEndMs = null;
    this.turnChunks = [];
    this.turnSamples = 0;
    this.turnDraftText = "";
  }

  private maybeForceTurnCut() {
    const turnId = this.currentTurnId;
    if (!turnId) return;
    const timing = this.timingsByTurnId.get(turnId);
    const startMs = timing?.startMs ?? this.speechStartMs;
    if (startMs == null) return;
    if (this.audioCursorNowMs() - startMs <= this.rollingCfg.maxWindowSeconds * 1000) return;
    this.forceCutTurn();
  }

  private forceCutTurn() {
    if (!this.inSpeech) return;
    const oldTurnId = this.currentTurnId;
    if (!oldTurnId) return;

    const timing = this.timingsByTurnId.get(oldTurnId) ?? {};
    const startMs = timing.startMs ?? this.speechStartMs ?? 0;
    const endMs = this.audioCursorNowMs();
    timing.startMs = startMs;
    timing.endMs = endMs;
    this.timingsByTurnId.set(oldTurnId, timing);

    // Best-effort finalize with current draft (no extra request).
    this.emit({
      type: "stt.final",
      sessionId: this.sessionId,
      turnId: oldTurnId,
      segmentId: oldTurnId,
      text: this.turnDraftText,
      startMs,
      endMs,
    });
    if (this.openTurns.has(oldTurnId)) {
      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId: oldTurnId,
        startMs,
        endMs,
      });
      this.openTurns.delete(oldTurnId);
    }

    // Start new turn with overlap audio.
    const newTurnId = newId("turn");
    const overlap = this.snapshotTailSamples(
      this.turnChunks,
      this.turnSamples,
      this.rollingCfg.overlapSamples,
    );
    this.currentTurnId = newTurnId;
    this.turnDraftText = "";
    this.turnChunks = [];
    this.turnSamples = 0;
    if (overlap.length > 0) this.appendToTurn(overlap);

    const newStartMs = Math.max(0, endMs - Math.floor(this.rollingCfg.overlapSeconds * 1000));
    this.speechStartMs = newStartMs;
    this.timingsByTurnId.set(newTurnId, { startMs: newStartMs });
    this.openTurns.add(newTurnId);
    this.emit({
      type: "turn.start",
      sessionId: this.sessionId,
      turnId: newTurnId,
      startMs: newStartMs,
    });
  }

  private appendToPreSpeech(chunk: Int16Array) {
    this.preSpeechChunks.push(chunk);
    this.preSpeechSamples += chunk.length;
    this.trimChunksToMaxSamples(
      this.preSpeechChunks,
      () => this.preSpeechSamples,
      (v) => {
        this.preSpeechSamples = v;
      },
      this.rollingCfg.preSpeechMaxSamples,
    );
  }

  private appendToTurn(chunk: Int16Array) {
    this.turnChunks.push(chunk);
    this.turnSamples += chunk.length;
    this.trimChunksToMaxSamples(
      this.turnChunks,
      () => this.turnSamples,
      (v) => {
        this.turnSamples = v;
      },
      this.rollingCfg.maxWindowSamples,
    );
  }

  private trimChunksToMaxSamples(
    chunks: Int16Array[],
    getTotal: () => number,
    setTotal: (n: number) => void,
    maxSamples: number,
  ) {
    let total = getTotal();
    while (total > maxSamples && chunks.length > 0) {
      const first = chunks[0];
      if (!first) break;
      const extra = total - maxSamples;
      if (first.length <= extra) {
        chunks.shift();
        total -= first.length;
        continue;
      }
      // Trim the first chunk.
      chunks[0] = first.subarray(extra);
      total -= extra;
      break;
    }
    setTotal(total);
  }

  private snapshotTailSamples(chunks: Int16Array[], totalSamples: number, tailSamples: number) {
    const want = Math.max(0, Math.min(totalSamples, tailSamples));
    if (want === 0) return new Int16Array();
    const out = new Int16Array(want);
    let remaining = want;
    let writePos = want;
    for (let i = chunks.length - 1; i >= 0 && remaining > 0; i--) {
      const c = chunks[i];
      const take = Math.min(remaining, c.length);
      writePos -= take;
      out.set(c.subarray(c.length - take), writePos);
      remaining -= take;
    }
    return out;
  }
}

function longestCommonPrefixLength(a: string, b: string) {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function clampNumber(n: number, min: number, max: number) {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

