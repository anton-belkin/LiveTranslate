import type { Lang, ServerToClientMessage } from "@livetranslate/shared";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { newId } from "../../util/id.js";
import { resamplePcm16MonoLinear } from "../resamplePcm16.js";
import type { AzureSpeechConfig } from "./config.js";

type Emit = (msg: ServerToClientMessage) => void;
type SttEvent =
  | {
      kind: "partial";
      turnId: string;
      segmentId: string;
      text: string;
      lang?: Lang;
      startMs: number;
    }
  | {
      kind: "final";
      turnId: string;
      segmentId: string;
      text: string;
      lang?: Lang;
      startMs: number;
      endMs: number;
    };

type AdapterState = "idle" | "starting" | "open" | "stopping" | "stopped";

const DEFAULT_TARGET_SAMPLE_RATE_HZ = 16_000;
const SPEAKER_RECENT_MS = 3000;
const DEBUG_LOGS = process.env.LIVETRANSLATE_DEBUG_LOGS === "true";

function debugLog(payload: Record<string, unknown>) {
  if (!DEBUG_LOGS) return;
  fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function toMs(ticks?: number) {
  if (!Number.isFinite(ticks)) return undefined;
  return Math.max(0, Math.floor((ticks ?? 0) / 10_000));
}

function toLang(locale?: string): Lang | undefined {
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
  private readonly onSttEvent?: (evt: SttEvent) => void;
  private readonly config: AzureSpeechConfig;
  private readonly targetSampleRateHz: number;
  private readonly enableDiarization: boolean;

  private recognizer: sdk.SpeechRecognizer | null = null;
  private diarizationRecognizer: sdk.ConversationTranscriber | null = null;
  private sttStream: sdk.PushAudioInputStream | null = null;
  private diarizationStream: sdk.PushAudioInputStream | null = null;

  private currentTurnId: string | null = null;
  private currentTurnStartMs: number | null = null;
  private currentSpeakerId: string | undefined = undefined;
  private pendingEndMs: number | null = null;
  private lastPartialText = "";

  private currentFromLang: Lang | undefined = undefined;
  private pendingSpeakerId: string | undefined = undefined;
  private pendingSpeakerAtMs: number | undefined = undefined;

  constructor(args: {
    sessionId: string;
    emit: Emit;
    onError: (err: Error) => void;
    onSttEvent?: (evt: SttEvent) => void;
    config: AzureSpeechConfig;
  }) {
    this.sessionId = args.sessionId;
    this.emit = args.emit;
    this.onError = args.onError;
    this.onSttEvent = args.onSttEvent;
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
    const autoDetectConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages(
      this.config.autoDetectLanguages,
    );

    this.sttStream = stream;
    this.recognizer = sdk.SpeechRecognizer.FromConfig(
      speechConfig,
      autoDetectConfig,
      audioConfig,
    );
    this.bindSttHandlers(this.recognizer);
    this.recognizer.startContinuousRecognitionAsync(
      () => {
        if (this.state !== "stopping" && this.state !== "stopped") {
          this.state = "open";
        }
      },
      (err) => this.handleStartError(err),
    );

    this.startDiarization(format);
  }

  pushAudioFrame(args: { pcm16: Uint8Array; sampleRateHz: number }) {
    if (this.state === "stopping" || this.state === "stopped") return;
    const stream = this.sttStream;
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

    const buffer = bytes.slice().buffer;
    try {
      stream.write(buffer);
      if (this.diarizationStream) this.diarizationStream.write(buffer);
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
    this.sttStream?.close();
    this.sttStream = null;

    const diarization = this.diarizationRecognizer;
    this.diarizationRecognizer = null;
    this.diarizationStream?.close();
    this.diarizationStream = null;

    if (!recognizer && !diarization) {
      this.state = "stopped";
      return;
    }

    await Promise.all([
      recognizer
        ? new Promise<void>((resolve) => {
            recognizer.stopContinuousRecognitionAsync(
              () => resolve(),
              () => resolve(),
            );
          })
        : Promise.resolve(),
      diarization
        ? new Promise<void>((resolve) => {
            diarization.stopTranscribingAsync(
              () => resolve(),
              () => resolve(),
            );
          })
        : Promise.resolve(),
    ]);

    try {
      recognizer?.close();
      diarization?.close();
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

    const primaryLang = cfg.autoDetectLanguages[0];
    if (primaryLang) speechConfig.speechRecognitionLanguage = primaryLang;

    return speechConfig;
  }

  private startDiarization(format: sdk.AudioStreamFormat) {
    const useDiarization =
      this.enableDiarization && typeof sdk.ConversationTranscriber === "function";
    if (!useDiarization) return;

    const speechConfig = this.config.endpoint
      ? sdk.SpeechConfig.fromEndpoint(new URL(this.config.endpoint), this.config.key)
      : sdk.SpeechConfig.fromSubscription(this.config.key, this.config.region);
    const diarizationProperty = (sdk.PropertyId as Record<string, number | string>)
      ?.SpeechServiceConnection_SingleChannelDiarization;
    if (diarizationProperty != null) {
      speechConfig.setProperty(diarizationProperty as sdk.PropertyId, "true");
    }

    const primaryLang = this.config.autoDetectLanguages[0];
    if (primaryLang) speechConfig.speechRecognitionLanguage = primaryLang;

    const stream = sdk.AudioInputStream.createPushStream(format);
    const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
    const transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);

    this.diarizationStream = stream;
    this.diarizationRecognizer = transcriber;

    this.bindDiarizationHandlers(transcriber);
    transcriber.startTranscribingAsync(
      () => undefined,
      (err) => this.onError(new Error(String(err))),
    );
  }

  private bindSttHandlers(recognizer: sdk.SpeechRecognizer) {
    recognizer.recognizing = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const text = String(result.text ?? "").trim();
      const offsetMs = toMs(result.offset);
      const turnId = this.ensureTurn(offsetMs);
      const from = this.resolveFromLang(result);

      if (text && text !== this.lastPartialText) {
        this.lastPartialText = text;
        this.emit({
          type: "stt.partial",
          sessionId: this.sessionId,
          turnId,
          segmentId: turnId,
          lang: from,
          text,
          startMs: this.currentTurnStartMs ?? offsetMs ?? 0,
        });
        this.onSttEvent?.({
          kind: "partial",
          turnId,
          segmentId: turnId,
          text,
          lang: from,
          startMs: this.currentTurnStartMs ?? offsetMs ?? 0,
        });
      }
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
      const turnId = this.ensureTurn(startMs);
      const from = this.resolveFromLang(result);

      this.emit({
        type: "stt.final",
        sessionId: this.sessionId,
        turnId,
        segmentId: turnId,
        lang: from,
        text,
        startMs,
        endMs,
      });
      this.onSttEvent?.({
        kind: "final",
        turnId,
        segmentId: turnId,
        text,
        lang: from,
        startMs,
        endMs,
      });

      this.emit({
        type: "turn.final",
        sessionId: this.sessionId,
        turnId,
        startMs,
        endMs,
        speakerId: this.currentSpeakerId,
      });
      this.resetTurnState();
    };

    recognizer.speechStartDetected = (_sender, evt) => {
      const offsetMs = toMs(evt?.offset);
      this.ensureTurn(offsetMs);
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

  private bindDiarizationHandlers(recognizer: sdk.ConversationTranscriber) {
    recognizer.transcribing = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const speakerId =
        typeof (result as { speakerId?: string }).speakerId === "string"
          ? String((result as { speakerId?: string }).speakerId)
          : undefined;
      if (!speakerId) return;
      const offsetMs = toMs(result.offset);
      this.noteSpeaker({ speakerId, offsetMs });
    };

    recognizer.transcribed = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const speakerId =
        typeof (result as { speakerId?: string }).speakerId === "string"
          ? String((result as { speakerId?: string }).speakerId)
          : undefined;
      if (!speakerId) return;
      const offsetMs = toMs(result.offset);
      this.noteSpeaker({ speakerId, offsetMs });
    };

    recognizer.canceled = (_sender, evt) => {
      const details =
        evt?.errorDetails ??
        evt?.reason?.toString?.() ??
        "Azure diarization canceled";
      this.onError(new Error(details));
    };
  }

  private resolveFromLang(result: sdk.SpeechRecognitionResult): Lang | undefined {
    let detected: Lang | undefined;
    let autoLang: string | undefined;
    let resultLang: string | undefined;
    try {
      const auto = sdk.AutoDetectSourceLanguageResult.fromResult(
        result,
      );
      autoLang = auto?.language;
      detected = toLang(autoLang);
    } catch {
      // ignore
    }

    if (!detected && typeof (result as { language?: string }).language === "string") {
      resultLang = (result as { language?: string }).language;
      detected = toLang(resultLang);
    }

    if (detected && !this.currentFromLang) this.currentFromLang = detected;
    // #region agent log
    debugLog({
      location: "azureSpeechSttAdapter.ts:resolveFromLang",
      message: "resolved speech language",
      data: {
        autoLang: autoLang ?? null,
        resultLang: resultLang ?? null,
        detected: detected ?? null,
        currentFromLang: this.currentFromLang ?? null,
      },
      timestamp: Date.now(),
      sessionId: "debug-session",
      runId: "run1",
      hypothesisId: "H3",
    });
    // #endregion
    return this.currentFromLang ?? detected;
  }

  private ensureTurn(offsetMs?: number): string {
    if (!this.currentTurnId) {
      this.currentTurnId = newId("turn");
      this.currentTurnStartMs = offsetMs ?? 0;
      this.pendingEndMs = null;
      this.currentSpeakerId = this.resolveSpeakerIdForTurn(offsetMs);
      this.emit({
        type: "turn.start",
        sessionId: this.sessionId,
        turnId: this.currentTurnId,
        startMs: this.currentTurnStartMs,
        speakerId: this.currentSpeakerId ?? undefined,
      });
      return this.currentTurnId;
    }

    if (this.currentTurnStartMs == null && offsetMs != null) {
      this.currentTurnStartMs = offsetMs;
    }
    return this.currentTurnId;
  }

  private resolveSpeakerIdForTurn(offsetMs?: number): string | undefined {
    if (!this.pendingSpeakerId) return undefined;
    if (this.pendingSpeakerAtMs == null || offsetMs == null) {
      const speakerId = this.pendingSpeakerId;
      this.pendingSpeakerId = undefined;
      this.pendingSpeakerAtMs = undefined;
      return speakerId;
    }

    if (Math.abs(offsetMs - this.pendingSpeakerAtMs) <= SPEAKER_RECENT_MS) {
      const speakerId = this.pendingSpeakerId;
      this.pendingSpeakerId = undefined;
      this.pendingSpeakerAtMs = undefined;
      return speakerId;
    }
    return undefined;
  }

  private noteSpeaker(args: { speakerId: string; offsetMs?: number }) {
    if (this.currentTurnId) {
      if (!this.currentSpeakerId) {
        this.currentSpeakerId = args.speakerId;
      }
      return;
    }

    this.pendingSpeakerId = args.speakerId;
    if (args.offsetMs != null) this.pendingSpeakerAtMs = args.offsetMs;
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
        lang: this.currentFromLang,
        text: this.lastPartialText,
        startMs,
        endMs,
      });
      this.onSttEvent?.({
        kind: "final",
        turnId,
        segmentId: turnId,
        text: this.lastPartialText,
        lang: this.currentFromLang,
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
    this.currentFromLang = undefined;
  }

  private handleStartError(err: unknown) {
    this.state = "stopped";
    this.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
