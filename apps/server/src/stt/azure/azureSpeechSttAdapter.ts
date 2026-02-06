import type { Lang, ServerToClientMessage } from "@livetranslate/shared";
import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { newId } from "../../util/id.js";
import { resamplePcm16MonoLinear } from "../resamplePcm16.js";
import type { AzureSpeechConfig } from "./config.js";

type Emit = (msg: ServerToClientMessage) => void;

type AdapterState = "idle" | "starting" | "open" | "stopping" | "stopped";

const DEFAULT_TARGET_SAMPLE_RATE_HZ = 16_000;
const SPEAKER_RECENT_MS = 3000;
const PARTIAL_CONFIDENCE_THRESHOLD = 0.6;

function toMs(ticks?: number) {
  if (!Number.isFinite(ticks)) return undefined;
  return Math.max(0, Math.floor((ticks ?? 0) / 10_000));
}

function toLang(locale?: string): Lang | undefined {
  if (!locale) return undefined;
  const l = locale.toLowerCase();
  if (l === "de" || l.startsWith("de-")) return "de";
  if (l === "en" || l.startsWith("en-")) return "en";
  if (l === "ru" || l.startsWith("ru-")) return "ru";
  return undefined;
}

function clampSampleRate(value?: number) {
  if (!value || !Number.isFinite(value)) return DEFAULT_TARGET_SAMPLE_RATE_HZ;
  const v = Math.round(value);
  if (v < 8000) return 8000;
  if (v > 48000) return 48000;
  return v;
}

function getTranslationText(args: {
  result: sdk.TranslationRecognitionResult;
  target: Lang;
}): string | null {
  const translations = (args.result as unknown as { translations?: unknown })
    .translations;
  if (!translations) return null;

  if (typeof (translations as Map<string, string>).get === "function") {
    const map = translations as Map<string, string>;
    const direct = map.get(args.target);
    if (typeof direct === "string") return direct;
    for (const [key, value] of map.entries()) {
      if (toLang(key) === args.target && typeof value === "string") return value;
    }
    return null;
  }

  if (typeof translations === "object" && translations !== null) {
    for (const [key, value] of Object.entries(translations as Record<string, string>)) {
      if (toLang(key) === args.target && typeof value === "string") return value;
    }
  }

  return null;
}

function getTranslationKeys(result: sdk.TranslationRecognitionResult): string[] {
  const translations = (result as unknown as { translations?: unknown }).translations;
  if (!translations) return [];
  if (typeof (translations as Map<string, string>).keys === "function") {
    return Array.from((translations as Map<string, string>).keys());
  }
  if (typeof translations === "object" && translations !== null) {
    return Object.keys(translations as Record<string, string>);
  }
  return [];
}

function getConfidence(result: sdk.TranslationRecognitionResult): number | undefined {
  const json = result.properties?.getProperty(
    sdk.PropertyId.SpeechServiceResponse_JsonResult,
  );
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as { NBest?: Array<{ Confidence?: number }> };
    const confidence = parsed?.NBest?.[0]?.Confidence;
    return typeof confidence === "number" ? confidence : undefined;
  } catch {
    return undefined;
  }
}

type RecognizerEntry = {
  lang: Lang;
  locale: string;
  recognizer: sdk.TranslationRecognizer;
  stream: sdk.PushAudioInputStream;
};

type FinalCandidate = {
  lang: Lang;
  confidence: number;
  result: sdk.TranslationRecognitionResult;
  offsetMs?: number;
  durationMs?: number;
  textLen: number;
};

type LastFinalTurn = {
  turnId: string;
  startMs: number;
  endMs: number;
  finalizedAtMs: number;
};

export class AzureSpeechSttAdapter {
  private state: AdapterState = "idle";
  private readonly sessionId: string;
  private readonly emit: Emit;
  private readonly onError: (err: Error) => void;
  private readonly config: AzureSpeechConfig;
  private readonly targetSampleRateHz: number;
  private readonly enableDiarization: boolean;
  private readonly enableRu: boolean;
  private readonly translationTargets: Lang[];

  private recognizers: RecognizerEntry[] = [];
  private diarizationRecognizer: sdk.ConversationTranscriber | null = null;
  private diarizationStream: sdk.PushAudioInputStream | null = null;

  private currentTurnId: string | null = null;
  private currentTurnStartMs: number | null = null;
  private currentSpeakerId: string | undefined = undefined;
  private pendingEndMs: number | null = null;
  private lastPartialText = "";
  private bestPartialScore: number | null = null;

  private currentFromLang: Lang | undefined = undefined;
  private lastTranslationTextByLang: Partial<Record<Lang, string>> = {};
  private translationRevisionByLang: Partial<Record<Lang, number>> = {};

  private finalCandidatesByLang: Partial<Record<Lang, FinalCandidate>> = {};
  private finalFlushTimer: NodeJS.Timeout | null = null;
  private lastFinalTurn: LastFinalTurn | null = null;

  private pendingSpeakerId: string | undefined = undefined;
  private pendingSpeakerAtMs: number | undefined = undefined;

  constructor(args: {
    sessionId: string;
    emit: Emit;
    onError: (err: Error) => void;
    config: AzureSpeechConfig;
    enableRu?: boolean;
  }) {
    this.sessionId = args.sessionId;
    this.emit = args.emit;
    this.onError = args.onError;
    this.config = args.config;
    this.enableRu = Boolean(args.enableRu);
    this.targetSampleRateHz = clampSampleRate(args.config.sampleRateHz);
    this.enableDiarization = Boolean(args.config.enableDiarization);
    const baseTargets = args.config.translationTargets
      .map((target) => toLang(target))
      .filter((lang): lang is Lang => Boolean(lang));
    this.translationTargets = this.enableRu
      ? baseTargets
      : baseTargets.filter((lang) => lang !== "ru");
  }

  start() {
    if (this.state !== "idle") return;
    this.state = "starting";

    const format = sdk.AudioStreamFormat.getWaveFormatPCM(
      this.targetSampleRateHz,
      16,
      1,
    );
    this.recognizers = this.buildRecognizers(format);
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'azureSpeechSttAdapter.ts:start',message:'recognizers configured',data:{enableRu:this.enableRu,translationTargets:this.translationTargets,sourceLocales:this.recognizers.map((entry)=>({lang:entry.lang,locale:entry.locale}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    if (this.recognizers.length === 0) {
      this.handleStartError(new Error("No speech recognizers configured."));
      return;
    }

    let pendingStart = this.recognizers.length;
    for (const entry of this.recognizers) {
      this.bindTranslationHandlers(entry.recognizer, entry.lang);
      entry.recognizer.startContinuousRecognitionAsync(
        () => {
          pendingStart -= 1;
          if (pendingStart === 0 && this.state !== "stopping" && this.state !== "stopped") {
            this.state = "open";
          }
        },
        (err) => this.handleStartError(err),
      );
    }

    this.startDiarization(format);
  }

  pushAudioFrame(args: { pcm16: Uint8Array; sampleRateHz: number }) {
    if (this.state === "stopping" || this.state === "stopped") return;
    if (this.recognizers.length === 0) return;

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
      for (const entry of this.recognizers) {
        entry.stream.write(bytes);
      }
      if (this.diarizationStream) this.diarizationStream.write(bytes);
    } catch (err) {
      this.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  async stop(args?: { reason?: string }) {
    if (this.state === "stopped") return;
    this.state = "stopping";

    this.flushOpenTurn();

    const recognizers = this.recognizers;
    this.recognizers = [];
    for (const entry of recognizers) {
      try {
        entry.stream.close();
      } catch {
        // ignore stream close errors
      }
    }

    const diarization = this.diarizationRecognizer;
    this.diarizationRecognizer = null;
    this.diarizationStream?.close();
    this.diarizationStream = null;

    if (recognizers.length === 0 && !diarization) {
      this.state = "stopped";
      return;
    }

    await Promise.all([
      ...recognizers.map(
        (entry) =>
          new Promise<void>((resolve) => {
            entry.recognizer.stopContinuousRecognitionAsync(resolve, resolve);
          }),
      ),
      diarization
        ? new Promise<void>((resolve) => {
            diarization.stopTranscribingAsync(resolve, resolve);
          })
        : Promise.resolve(),
    ]);

    try {
      for (const entry of recognizers) {
        entry.recognizer.close();
      }
      diarization?.close();
    } catch (err) {
      if (args?.reason === "server_shutdown") return;
      this.onError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      this.state = "stopped";
    }
  }

  private buildTranslationConfig(sourceLocale: string) {
    const cfg = this.config;
    const speechConfig = cfg.endpoint
      ? sdk.SpeechTranslationConfig.fromEndpoint(new URL(cfg.endpoint), cfg.key)
      : sdk.SpeechTranslationConfig.fromSubscription(cfg.key, cfg.region);

    speechConfig.speechRecognitionLanguage = sourceLocale;
    speechConfig.outputFormat = sdk.OutputFormat.Detailed;

    for (const target of this.translationTargets) {
      speechConfig.addTargetLanguage(target);
    }

    return speechConfig;
  }

  private resolveSourceLocales(): Array<{ lang: Lang; locale: string }> {
    const raw = this.config.autoDetectLanguages.length
      ? this.config.autoDetectLanguages
      : ["de-DE", "en-US", "ru-RU"];
    const byLang = new Map<Lang, string>();
    for (const locale of raw) {
      const lang = toLang(locale);
      if (!lang) continue;
      if (!byLang.has(lang)) byLang.set(lang, locale);
    }
    if (!byLang.has("de")) byLang.set("de", "de-DE");
    if (!byLang.has("en")) byLang.set("en", "en-US");
    if (this.enableRu) {
      if (!byLang.has("ru")) byLang.set("ru", "ru-RU");
    } else {
      byLang.delete("ru");
    }

    const order: Lang[] = this.enableRu ? ["de", "en", "ru"] : ["de", "en"];
    return order
      .map((lang) => {
        const locale = byLang.get(lang);
        return locale ? { lang, locale } : undefined;
      })
      .filter((entry): entry is { lang: Lang; locale: string } => Boolean(entry));
  }

  private buildRecognizers(format: sdk.AudioStreamFormat): RecognizerEntry[] {
    const sources = this.resolveSourceLocales();
    return sources.map((source) => {
      const speechConfig = this.buildTranslationConfig(source.locale);
      const stream = sdk.AudioInputStream.createPushStream(format);
      const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
      const autoDetectConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages([
        source.locale,
      ]);
      const recognizer = sdk.TranslationRecognizer.FromConfig(
        speechConfig,
        autoDetectConfig,
        audioConfig,
      );
      return { ...source, recognizer, stream };
    });
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

    const primaryLocale = this.resolveSourceLocales()[0]?.locale;
    if (primaryLocale) speechConfig.speechRecognitionLanguage = primaryLocale;

    const stream = sdk.AudioInputStream.createPushStream(format);
    const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
    const transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);

    this.diarizationStream = stream;
    this.diarizationRecognizer = transcriber;

    this.bindDiarizationHandlers(transcriber);
    transcriber.startTranscribingAsync(
      () => undefined,
      (err) => this.onError(err instanceof Error ? err : new Error(String(err))),
    );
  }

  private bindTranslationHandlers(recognizer: sdk.TranslationRecognizer, from: Lang) {
    recognizer.recognizing = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const text = String(result.text ?? "").trim();
      const confidence = getConfidence(result);
      const hasConfidence = confidence != null;
      const score = hasConfidence ? confidence : text.length;
      if (hasConfidence && confidence < PARTIAL_CONFIDENCE_THRESHOLD) return;
      const offsetMs = toMs(result.offset);
      const turnId = this.ensureTurn(offsetMs);
      const shouldEmit =
        this.bestPartialScore == null || score >= this.bestPartialScore;

      if (shouldEmit && text && this.lastPartialText.length === 0) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'azureSpeechSttAdapter.ts:recognizing',message:'first partial for turn',data:{from,hasConfidence,confidence,textLen:text.length,bestPartialScore:this.bestPartialScore,translationKeys:getTranslationKeys(result)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
        // #endregion
      }

      if (shouldEmit && text && text !== this.lastPartialText) {
        this.lastPartialText = text;
        this.bestPartialScore = score;
        this.currentFromLang = from;
        this.emit({
          type: "stt.partial",
          sessionId: this.sessionId,
          turnId,
          segmentId: turnId,
          lang: from,
          text,
          startMs: this.currentTurnStartMs ?? offsetMs ?? 0,
        });
      }

      if (shouldEmit) {
        for (const target of this.translationTargets) {
          const translation = getTranslationText({
            result,
            target,
          });
          if (translation) {
            this.emitTranslatePartial({
              turnId,
              from,
              to: target,
              text: translation,
            });
          }
        }
      }
    };

    recognizer.recognized = (_sender, evt) => {
      const result = evt?.result;
      if (!result) return;
      const reason = result.reason;
      if (
        reason !== sdk.ResultReason.TranslatedSpeech &&
        reason !== sdk.ResultReason.RecognizedSpeech
      ) {
        return;
      }

      const text = String(result.text ?? "").trim();
      if (!text) return;
      const offsetMs = toMs(result.offset);
      const durationMs = toMs(result.duration) ?? 0;
      const confidence = getConfidence(result) ?? 0;
      const textLen = text.length;
      if (offsetMs != null && this.shouldIgnoreLateFinal(offsetMs)) return;
      const turnId = this.ensureTurn(offsetMs);

      const existing = this.finalCandidatesByLang[from];
      if (
        !existing ||
        confidence > existing.confidence ||
        (confidence === existing.confidence && textLen >= existing.textLen)
      ) {
        this.finalCandidatesByLang[from] = {
          lang: from,
          confidence,
          result,
          offsetMs: offsetMs ?? undefined,
          durationMs,
          textLen,
        };
      }

      const readyCount = Object.keys(this.finalCandidatesByLang).length;
      if (readyCount >= this.recognizers.length) {
        this.flushFinalCandidates(turnId);
      } else {
        this.scheduleFinalFlush(turnId);
      }
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

  private scheduleFinalFlush(turnId: string) {
    if (this.finalFlushTimer) return;
    this.finalFlushTimer = setTimeout(() => {
      this.finalFlushTimer = null;
      this.flushFinalCandidates(turnId);
    }, 600);
  }

  private flushFinalCandidates(turnId?: string) {
    if (turnId && this.currentTurnId && turnId !== this.currentTurnId) return;
    const candidates = Object.values(this.finalCandidatesByLang).filter(
      (entry): entry is FinalCandidate => Boolean(entry),
    );
    if (candidates.length === 0) return;

    const best = candidates.reduce((acc, cur) => {
      if (cur.confidence > acc.confidence) return cur;
      if (cur.confidence < acc.confidence) return acc;
      const preferLang = this.currentFromLang;
      if (preferLang) {
        const accPreferred = acc.lang === preferLang;
        const curPreferred = cur.lang === preferLang;
        if (curPreferred && !accPreferred) return cur;
        if (accPreferred && !curPreferred) return acc;
      }
      if (cur.textLen > acc.textLen) return cur;
      if (cur.textLen < acc.textLen) return acc;
      return (cur.durationMs ?? 0) >= (acc.durationMs ?? 0) ? cur : acc;
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'azureSpeechSttAdapter.ts:flushFinalCandidates',message:'final candidates evaluated',data:{candidates:candidates.map((entry)=>({lang:entry.lang,confidence:entry.confidence,textLen:entry.textLen,durationMs:entry.durationMs})),selected:{lang:best.lang,confidence:best.confidence,textLen:best.textLen,durationMs:best.durationMs}},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    const result = best.result;
    const text = String(result.text ?? "").trim();
    if (!text) return;

    const offsetMs = best.offsetMs;
    const durationMs = best.durationMs ?? 0;
    const startMs = this.currentTurnStartMs ?? offsetMs ?? 0;
    const endMs =
      this.pendingEndMs ?? (offsetMs != null ? offsetMs + durationMs : startMs);
    const turnIdResolved = this.ensureTurn(startMs);
    const from = best.lang;
    this.currentFromLang = from;


    this.emit({
      type: "stt.final",
      sessionId: this.sessionId,
      turnId: turnIdResolved,
      segmentId: turnIdResolved,
      lang: from,
      text,
      startMs,
      endMs,
    });
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'azureSpeechSttAdapter.ts:emitFinal',message:'stt.final emitted',data:{turnId:turnIdResolved,from,textLen:text.length,startMs,endMs},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion

    for (const target of this.translationTargets) {
      const translation = getTranslationText({
        result,
        target,
      });
      const prevText = this.lastTranslationTextByLang[target] ?? "";
      const finalText = translation ?? prevText;
      if (finalText) {
        if (translation && prevText && !translation.startsWith(prevText)) {
          this.emitTranslateRevise({
            turnId: turnIdResolved,
            from,
            to: target,
            text: translation,
          });
        }
        this.lastTranslationTextByLang[target] = finalText;
        this.emit({
          type: "translate.final",
          sessionId: this.sessionId,
          turnId: turnIdResolved,
          segmentId: turnIdResolved,
          from,
          to: target,
          text: finalText,
        });
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'azureSpeechSttAdapter.ts:emitFinal',message:'translate.final emitted',data:{turnId:turnIdResolved,from,to:target,textLen:finalText.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
        // #endregion
      }
    }

    this.emit({
      type: "turn.final",
      sessionId: this.sessionId,
      turnId: turnIdResolved,
      startMs,
      endMs,
      speakerId: this.currentSpeakerId,
    });
    this.lastFinalTurn = {
      turnId: turnIdResolved,
      startMs,
      endMs,
      finalizedAtMs: Date.now(),
    };
    this.resetTurnState();
  }

  private shouldIgnoreLateFinal(offsetMs: number) {
    if (!this.lastFinalTurn) return false;
    const graceMs = 1500;
    const now = Date.now();
    if (now - this.lastFinalTurn.finalizedAtMs > graceMs) return false;
    if (offsetMs < this.lastFinalTurn.startMs) return false;
    return offsetMs <= this.lastFinalTurn.endMs + 500;
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

  private emitTranslatePartial(args: {
    turnId: string;
    from: Lang;
    to: Lang;
    text: string;
  }) {
    const nextText = args.text;
    if (!nextText || nextText.trim().length === 0) return;

    const prev = this.lastTranslationTextByLang[args.to] ?? "";
    if (!prev) {
      this.lastTranslationTextByLang[args.to] = nextText;
      this.emit({
        type: "translate.partial",
        sessionId: this.sessionId,
        turnId: args.turnId,
        segmentId: args.turnId,
        from: args.from,
        to: args.to,
        textDelta: nextText,
      });
      return;
    }

    if (nextText.startsWith(prev)) {
      const delta = nextText.slice(prev.length);
      if (delta.length > 0) {
        this.emit({
          type: "translate.partial",
          sessionId: this.sessionId,
          turnId: args.turnId,
          segmentId: args.turnId,
          from: args.from,
          to: args.to,
          textDelta: delta,
        });
      }
      this.lastTranslationTextByLang[args.to] = nextText;
      return;
    }

    this.emitTranslateRevise({
      turnId: args.turnId,
      from: args.from,
      to: args.to,
      text: nextText,
    });
    this.lastTranslationTextByLang[args.to] = nextText;
  }

  private emitTranslateRevise(args: {
    turnId: string;
    from: Lang;
    to: Lang;
    text: string;
  }) {
    this.translationRevisionByLang[args.to] =
      (this.translationRevisionByLang[args.to] ?? 0) + 1;
    this.emit({
      type: "translate.revise",
      sessionId: this.sessionId,
      turnId: args.turnId,
      segmentId: args.turnId,
      from: args.from,
      to: args.to,
      revision: this.translationRevisionByLang[args.to] ?? 0,
      fullText: args.text,
    });
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
    if (Object.keys(this.finalCandidatesByLang).length > 0) {
      this.flushFinalCandidates(this.currentTurnId);
      return;
    }
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
    }
    if (this.currentFromLang) {
      for (const target of this.translationTargets) {
        const text = this.lastTranslationTextByLang[target];
        if (!text) continue;
        this.emit({
          type: "translate.final",
          sessionId: this.sessionId,
          turnId,
          segmentId: turnId,
          from: this.currentFromLang,
          to: target,
          text,
        });
      }
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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'azureSpeechSttAdapter.ts:resetTurnState',message:'turn reset',data:{turnId:this.currentTurnId,lastPartialLen:this.lastPartialText.length,candidateCount:Object.keys(this.finalCandidatesByLang).length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H2'})}).catch(()=>{});
    // #endregion
    this.currentTurnId = null;
    this.currentTurnStartMs = null;
    this.pendingEndMs = null;
    this.currentSpeakerId = undefined;
    this.lastPartialText = "";
    this.bestPartialScore = null;
    this.currentFromLang = undefined;
    this.lastTranslationTextByLang = {};
    this.translationRevisionByLang = {};
    this.finalCandidatesByLang = {};
    if (this.finalFlushTimer) {
      clearTimeout(this.finalFlushTimer);
      this.finalFlushTimer = null;
    }
  }

  private handleStartError(err: unknown) {
    this.state = "stopped";
    this.onError(err instanceof Error ? err : new Error(String(err)));
  }
}
