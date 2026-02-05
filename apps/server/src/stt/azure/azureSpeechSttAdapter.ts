import type { ServerToClientMessage } from "@livetranslate/shared";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { newId } from "../../util/id.js";
import { resamplePcm16MonoLinear } from "../resamplePcm16.js";
import type { AzureSpeechConfig } from "./config.js";

type Emit = (msg: ServerToClientMessage) => void;

type AdapterState = "idle" | "starting" | "open" | "stopping" | "stopped";

const DEFAULT_TARGET_SAMPLE_RATE_HZ = 16_000;

function toMs(ticks?: number) {
  if (!Number.isFinite(ticks)) return undefined;
  return Math.max(0, Math.floor((ticks ?? 0) / 10_000));
}

function toLang(locale?: string): "de" | "en" | undefined {
  if (!locale) return undefined;
  const l = locale.toLowerCase();
  if (l === "de" || l.startsWith("de-")) return "de";
  if (l === "en" || l.startsWith("en-")) return "en";
  return undefined;
}

function clampSampleRate(value?: number) {
  if (!value || !Number.isFinite(value)) return DEFAULT_TARGET_SAMPLE_RATE_HZ;
  const v = Math.round(value);
  if (v < 8000) return 8000;
  if (v > 48000) return 48000;
  return v;
}

export class AzureSpeechSttAdapter {
  private state: AdapterState = "idle";
  private readonly sessionId: string;
  private readonly emit: Emit;
  private readonly onError: (err: Error) => void;
  private readonly config: AzureSpeechConfig;
  private readonly targetSampleRateHz: number;
  private readonly enableDiarization: boolean;
  private recognizer: sdk.SpeechRecognizer | sdk.ConversationTranscriber | null = null;
  private pushStream: sdk.PushAudioInputStream | null = null;

  private currentTurnId: string | null = null;
  private currentTurnStartMs: number | null = null;
  private currentSpeakerId: string | undefined = undefined;
  private pendingEndMs: number | null = null;
  private lastPartialText = "";

  constructor(args: {
    sessionId: string;
    emit: Emit;
    onError: (err: Error) => void;
    config: AzureSpeechConfig;
  }) {
    this.sessionId = args.sessionId;
    this.emit = args.emit;
    this.onError = args.onError;
    this.config = args.config;
    this.targetSampleRateHz = clampSampleRate(args.config.sampleRateHz);
    this.enableDiarization = Boolean(args.config.enableDiarization);
  }

  start() {
    if (this.state !== "idle") return;
    this.state = "starting";

    const speechConfig = this.buildSpeechConfig();
    const format = sdk.AudioStreamFormat.getWaveFormatPCM(
      this.targetSampleRateHz,
      16,
      1,
    );
    const stream = sdk.AudioInputStream.createPushStream(format);
    const audioConfig = sdk.AudioConfig.fromStreamInput(stream);

    this.pushStream = stream;

    const useDiarization =
      this.enableDiarization && typeof sdk.ConversationTranscriber === "function";

    if (useDiarization) {
      this.recognizer = new sdk.ConversationTranscriber(speechConfig, audioConfig);
      this.bindConversationHandlers(this.recognizer);
      this.recognizer.startTranscribingAsync(
        () => {
          if (this.state !== "stopping" && this.state !== "stopped") {
            this.state = "open";
          }
        },
        (err) => this.handleStartError(err),
      );
      return;
    }

    this.recognizer = new sdk.SpeechRecognizer(speechConfig, audioConfig);
    this.bindRecognizerHandlers(this.recognizer);
    this.recognizer.startContinuousRecognitionAsync(
      () => {
        if (this.state !== "stopping" && this.state !== "stopped") {
          this.state = "open";
        }
      },
      (err) => this.handleStartError(err),
    );
  }

  pushAudioFrame(args: { pcm16: Uint8Array; sampleRateHz: number }) {
    if (this.state === "stopping" || this.state === "stopped") return;
    const stream = this.pushStream;
    if (!stream) return;

    const samples = new Int16Array(
      args.pcm16.buffer,
      args.pcm16.byteOffset,
      Math.floor(args.pcm16.byteLength / 2),
    );
    const resampled =
      args.sampleRateHz === this.targetSampleRateHz
        ? samples
        : resamplePcm16MonoLinear({
            input: samples,
            inSampleRateHz: args.sampleRateHz,
            outSampleRateHz: this.targetSampleRateHz,
          });
    const bytes = new Uint8Array(
      resampled.buffer,
      resampled.byteOffset,
      resampled.byteLength,
    );

    try {
      stream.write(bytes);
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async stop(args?: { reason?: string }) {
    if (this.state === "stopped") return;
    this.state = "stopping";

    this.flushOpenTurn();

    const recognizer = this.recognizer;
    this.recognizer = null;
    this.pushStream?.close();
    this.pushStream = null;

    if (!recognizer) {
      this.state = "stopped";
      return;
    }

    await new Promise<void>((resolve) => {
      const onDone = () => resolve();
      if ("stopTranscribingAsync" in recognizer) {
        recognizer.stopTranscribingAsync(onDone, onDone);
      } else {
        recognizer.stopContinuousRecognitionAsync(onDone, onDone);
      }
    });

    try {
      recognizer.close();
    } catch (err) {
      if (args?.reason === "server_shutdown") return;
      this.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.state = "stopped";
    }
  }

  private buildSpeechConfig() {
    const cfg = this.config;
    const speechConfig = cfg.endpoint
      ? sdk.SpeechConfig.fromEndpoint(new URL(cfg.endpoint), cfg.key)
      : sdk.SpeechConfig.fromSubscription(cfg.key, cfg.region);
    if (cfg.recognitionLanguage) {
      speechConfig.speechRecognitionLanguage = cfg.recognitionLanguage;
    }
    const diarizationProperty = (sdk.PropertyId as Record<string, number | string>)
      ?.SpeechServiceConnection_SingleChannelDiarization;
    if (this.enableDiarization && diarizationProperty != null) {
      speechConfig.setProperty(diarizationProperty as sdk.PropertyId, "true");
    }
    return speechConfig;
  }

  private bindRecognizerHandlers(recognizer: sdk.SpeechRecognizer) {
    recognizer.recognizing = (_sender, evt) => {
      const text = String(evt?.result?.text ?? "").trim();
      if (!text) return;
      const offsetMs = toMs(evt?.result?.offset);
      const turnId = this.ensureTurn(offsetMs, undefined);
      if (text === this.lastPartialText) return;
      this.lastPartialText = text;
      this.emit({
        type: "stt.partial",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        lang: toLang(this.config.recognitionLanguage),
        text,
        startMs: this.currentTurnStartMs ?? offsetMs ?? 0,
      });
    };

    recognizer.recognized = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const reason = result.reason;
      if (reason !== sdk.ResultReason.RecognizedSpeech) return;
      const text = String(result.text ?? "").trim();
      if (!text) return;
      const offsetMs = toMs(result.offset);
      const durationMs = toMs(result.duration) ?? 0;
      const startMs = this.currentTurnStartMs ?? offsetMs ?? 0;
      const endMs =
        this.pendingEndMs ?? (offsetMs != null ? offsetMs + durationMs : startMs);
      const turnId = this.ensureTurn(startMs, undefined);
      this.emit({
        type: "stt.final",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        lang: toLang(this.config.recognitionLanguage),
        text,
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
      this.resetTurnState();
    };

    recognizer.speechStartDetected = (_sender, evt) => {
      const offsetMs = toMs(evt?.offset);
      this.ensureTurn(offsetMs, undefined);
    };

    recognizer.speechEndDetected = (_sender, evt) => {
      this.pendingEndMs = toMs(evt?.offset) ?? null;
    };

    recognizer.canceled = (_sender, evt) => {
      const details =
        evt?.errorDetails ?? evt?.reason?.toString?.() ?? "Azure STT canceled";
      this.onError(new Error(details));
    };

    recognizer.sessionStopped = () => {
      this.flushOpenTurn();
    };
  }

  private bindConversationHandlers(recognizer: sdk.ConversationTranscriber) {
    recognizer.transcribing = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const text = String(result.text ?? "").trim();
      if (!text) return;
      const offsetMs = toMs(result.offset);
      const speakerId = typeof (result as any).speakerId === "string"
        ? String((result as any).speakerId)
        : undefined;
      const turnId = this.ensureTurn(offsetMs, speakerId);
      if (text === this.lastPartialText) return;
      this.lastPartialText = text;
      this.emit({
        type: "stt.partial",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        lang: toLang(this.config.recognitionLanguage),
        text,
        startMs: this.currentTurnStartMs ?? offsetMs ?? 0,
      });
    };

    recognizer.transcribed = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const reason = result.reason;
      if (reason !== sdk.ResultReason.RecognizedSpeech) return;
      const text = String(result.text ?? "").trim();
      if (!text) return;
      const offsetMs = toMs(result.offset);
      const durationMs = toMs(result.duration) ?? 0;
      const speakerId = typeof (result as any).speakerId === "string"
        ? String((result as any).speakerId)
        : undefined;
      const startMs = this.currentTurnStartMs ?? offsetMs ?? 0;
      const endMs =
        this.pendingEndMs ?? (offsetMs != null ? offsetMs + durationMs : startMs);
      const turnId = this.ensureTurn(startMs, speakerId);
      this.emit({
        type: "stt.final",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        lang: toLang(this.config.recognitionLanguage),
        text,
        startMs,
        endMs,
      });
      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId,
        startMs,
        endMs,
        speakerId: speakerId ?? this.currentSpeakerId,
      });
      this.resetTurnState();
    };

    recognizer.speechStartDetected = (_sender, evt) => {
      const offsetMs = toMs(evt?.offset);
      this.ensureTurn(offsetMs, undefined);
    };

    recognizer.speechEndDetected = (_sender, evt) => {
      this.pendingEndMs = toMs(evt?.offset) ?? null;
    };

    recognizer.canceled = (_sender, evt) => {
      const details =
        evt?.errorDetails ?? evt?.reason?.toString?.() ?? "Azure STT canceled";
      this.onError(new Error(details));
    };

    recognizer.sessionStopped = () => {
      this.flushOpenTurn();
    };
  }

  private ensureTurn(offsetMs?: number, speakerId?: string): string {
    if (!this.currentTurnId) {
      this.currentTurnId = newId("turn");
      this.currentTurnStartMs = offsetMs ?? 0;
      this.pendingEndMs = null;
      this.currentSpeakerId = speakerId;
      this.emit({
        type: "turn.start",
        sessionId: this.sessionId,
        turnId: this.currentTurnId,
        startMs: this.currentTurnStartMs,
        speakerId: speakerId ?? undefined,
      });
      return this.currentTurnId;
    }

    if (speakerId && this.currentSpeakerId && speakerId !== this.currentSpeakerId) {
      this.flushOpenTurn();
      this.currentTurnId = newId("turn");
      this.currentTurnStartMs = offsetMs ?? 0;
      this.currentSpeakerId = speakerId;
      this.emit({
        type: "turn.start",
        sessionId: this.sessionId,
        turnId: this.currentTurnId,
        startMs: this.currentTurnStartMs,
        speakerId,
      });
      return this.currentTurnId;
    }

    if (speakerId) this.currentSpeakerId = speakerId;
    if (this.currentTurnStartMs == null && offsetMs != null) {
      this.currentTurnStartMs = offsetMs;
    }
    return this.currentTurnId;
  }

  private flushOpenTurn() {
    if (!this.currentTurnId) return;
    const startMs = this.currentTurnStartMs ?? 0;
    const endMs = this.pendingEndMs ?? startMs;
    const turnId = this.currentTurnId;
    if (this.lastPartialText) {
      this.emit({
        type: "stt.final",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        lang: toLang(this.config.recognitionLanguage),
        text: this.lastPartialText,
        startMs,
        endMs,
      });
    }
    this.emit({
      type: "turn.final",
      sessionId: this.sessionId,
      turnId,
      startMs,
      endMs,
      speakerId: this.currentSpeakerId,
    });
    this.resetTurnState();
  }

  private resetTurnState() {
    this.currentTurnId = null;
    this.currentTurnStartMs = null;
    this.pendingEndMs = null;
    this.currentSpeakerId = undefined;
    this.lastPartialText = "";
  }

  private handleStartError(err: unknown) {
    this.state = "stopped";
    this.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
