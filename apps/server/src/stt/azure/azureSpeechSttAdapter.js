import * as sdk from "microsoft-cognitiveservices-speech-sdk";
import { newId } from "../../util/id.js";
import { resamplePcm16MonoLinear } from "../resamplePcm16.js";
const DEFAULT_TARGET_SAMPLE_RATE_HZ = 16_000;
const SPEAKER_RECENT_MS = 3000;
const DEBUG_LOGS = process.env.LIVETRANSLATE_DEBUG_LOGS === "true";
function debugLog(payload) {
    if (!DEBUG_LOGS)
        return;
    fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    }).catch(() => { });
}
function toMs(ticks) {
    if (!Number.isFinite(ticks))
        return undefined;
    return Math.max(0, Math.floor((ticks ?? 0) / 10_000));
}
function toLang(locale) {
    if (!locale)
        return undefined;
    const l = locale.toLowerCase();
    if (l === "de" || l.startsWith("de-"))
        return "de";
    if (l === "en" || l.startsWith("en-"))
        return "en";
    return undefined;
}
function clampSampleRate(value) {
    if (!value || !Number.isFinite(value))
        return DEFAULT_TARGET_SAMPLE_RATE_HZ;
    const v = Math.round(value);
    if (v < 8000)
        return 8000;
    if (v > 48000)
        return 48000;
    return v;
}
export class AzureSpeechSttAdapter {
    state = "idle";
    sessionId;
    emit;
    onError;
    onSttEvent;
    config;
    targetSampleRateHz;
    enableDiarization;
    specialWords;
    specialWordsBoost;
    recognizer = null;
    diarizationRecognizer = null;
    sttStream = null;
    diarizationStream = null;
    currentTurnId = null;
    currentTurnStartMs = null;
    currentSpeakerId = undefined;
    pendingEndMs = null;
    lastPartialText = "";
    lastFinalLang = undefined;
    lastPartialLang = undefined;
    pendingSpeakerId = undefined;
    pendingSpeakerAtMs = undefined;
    constructor(args) {
        this.sessionId = args.sessionId;
        this.emit = args.emit;
        this.onError = args.onError;
        this.onSttEvent = args.onSttEvent;
        this.config = args.config;
        this.targetSampleRateHz = clampSampleRate(args.config.sampleRateHz);
        this.enableDiarization = Boolean(args.config.enableDiarization);
        this.specialWords = (args.specialWords ?? [])
            .map((word) => word.trim())
            .filter((word, idx, list) => word.length > 0 && list.indexOf(word) === idx);
        this.specialWordsBoost = this.clampInt(args.specialWordsBoost ?? 1, 1, 5);
    }
    start() {
        if (this.state !== "idle")
            return;
        this.state = "starting";
        const speechConfig = this.buildSpeechConfig();
        const format = sdk.AudioStreamFormat.getWaveFormatPCM(this.targetSampleRateHz, 16, 1);
        const stream = sdk.AudioInputStream.createPushStream(format);
        const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
        const autoDetectConfig = sdk.AutoDetectSourceLanguageConfig.fromLanguages(this.config.autoDetectLanguages);
        const sttEndpoint = this.getSttEndpointUrl();
        // #region agent log
        debugLog({
            location: "azureSpeechSttAdapter.ts:start",
            message: "starting azure recognizer",
            data: {
                autoDetectLanguages: this.config.autoDetectLanguages,
                primaryLang: this.config.autoDetectLanguages[0] ?? null,
                targetSampleRateHz: this.targetSampleRateHz,
                endpoint: sttEndpoint.toString(),
                languageIdMode: "Continuous",
                specialWords: this.specialWords,
                specialWordsCount: this.specialWords.length,
                specialWordsBoostIgnored: this.specialWordsBoost,
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            runId: "run1",
            hypothesisId: "H1",
        });
        // #endregion
        this.sttStream = stream;
        this.recognizer = sdk.SpeechRecognizer.FromConfig(speechConfig, autoDetectConfig, audioConfig);
        this.bindSttHandlers(this.recognizer);
        this.applyPhraseList(this.recognizer);
        this.recognizer.startContinuousRecognitionAsync(() => {
            if (this.state !== "stopping" && this.state !== "stopped") {
                this.state = "open";
            }
        }, (err) => this.handleStartError(err));
        this.startDiarization(format);
    }
    pushAudioFrame(args) {
        if (this.state === "stopping" || this.state === "stopped")
            return;
        const stream = this.sttStream;
        if (!stream)
            return;
        const samples = new Int16Array(args.pcm16.buffer, args.pcm16.byteOffset, Math.floor(args.pcm16.byteLength / 2));
        const resampled = args.sampleRateHz === this.targetSampleRateHz
            ? samples
            : resamplePcm16MonoLinear({
                input: samples,
                inSampleRateHz: args.sampleRateHz,
                outSampleRateHz: this.targetSampleRateHz,
            });
        const bytes = new Uint8Array(resampled.buffer, resampled.byteOffset, resampled.byteLength);
        const buffer = bytes.slice().buffer;
        try {
            stream.write(buffer);
            if (this.diarizationStream)
                this.diarizationStream.write(buffer);
        }
        catch (err) {
            this.onError(err instanceof Error ? err : new Error(String(err)));
        }
    }
    async stop(args) {
        if (this.state === "stopped")
            return;
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
                ? new Promise((resolve) => {
                    recognizer.stopContinuousRecognitionAsync(() => resolve(), () => resolve());
                })
                : Promise.resolve(),
            diarization
                ? new Promise((resolve) => {
                    diarization.stopTranscribingAsync(() => resolve(), () => resolve());
                })
                : Promise.resolve(),
        ]);
        try {
            recognizer?.close();
            diarization?.close();
        }
        catch (err) {
            if (args?.reason === "server_shutdown")
                return;
            this.onError(err instanceof Error ? err : new Error(String(err)));
        }
        finally {
            this.state = "stopped";
        }
    }
    buildSpeechConfig() {
        const cfg = this.config;
        const speechConfig = sdk.SpeechConfig.fromEndpoint(this.getSttEndpointUrl(), cfg.key);
        speechConfig.setProperty(sdk.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
        const primaryLang = cfg.autoDetectLanguages[0];
        if (primaryLang && cfg.autoDetectLanguages.length <= 1) {
            speechConfig.speechRecognitionLanguage = primaryLang;
        }
        // Optional tuning if finals are too sparse:
        // speechConfig.setProperty(
        //   sdk.PropertyId.Speech_SegmentationSilenceTimeoutMs,
        //   "600",
        // );
        return speechConfig;
    }
    getSttEndpointUrl() {
        if (this.config.endpoint)
            return new URL(this.config.endpoint);
        return new URL(`wss://${this.config.region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1`);
    }
    startDiarization(format) {
        const useDiarization = this.enableDiarization && typeof sdk.ConversationTranscriber === "function";
        if (!useDiarization)
            return;
        const speechConfig = this.config.endpoint
            ? sdk.SpeechConfig.fromEndpoint(new URL(this.config.endpoint), this.config.key)
            : sdk.SpeechConfig.fromSubscription(this.config.key, this.config.region);
        const diarizationProperty = sdk.PropertyId
            ?.SpeechServiceConnection_SingleChannelDiarization;
        if (diarizationProperty != null) {
            speechConfig.setProperty(diarizationProperty, "true");
        }
        const primaryLang = this.config.autoDetectLanguages[0];
        if (primaryLang)
            speechConfig.speechRecognitionLanguage = primaryLang;
        const stream = sdk.AudioInputStream.createPushStream(format);
        const audioConfig = sdk.AudioConfig.fromStreamInput(stream);
        const transcriber = new sdk.ConversationTranscriber(speechConfig, audioConfig);
        this.diarizationStream = stream;
        this.diarizationRecognizer = transcriber;
        this.bindDiarizationHandlers(transcriber);
        transcriber.startTranscribingAsync(() => undefined, (err) => this.onError(new Error(String(err))));
    }
    applyPhraseList(recognizer) {
        if (this.specialWords.length === 0)
            return;
        try {
            const phraseList = sdk.PhraseListGrammar.fromRecognizer(recognizer);
            for (const word of this.specialWords) {
                phraseList.addPhrase(word);
            }
            // #region agent log
            debugLog({
                location: "azureSpeechSttAdapter.ts:applyPhraseList",
                message: "phrase list applied",
                data: {
                    count: this.specialWords.length,
                    words: this.specialWords,
                    boostIgnored: this.specialWordsBoost,
                },
                timestamp: Date.now(),
                sessionId: "debug-session",
                runId: "run1",
                hypothesisId: "H4",
            });
            // #endregion
        }
        catch (err) {
            // #region agent log
            debugLog({
                location: "azureSpeechSttAdapter.ts:applyPhraseList",
                message: "phrase list failed",
                data: { error: String(err) },
                timestamp: Date.now(),
                sessionId: "debug-session",
                runId: "run1",
                hypothesisId: "H4",
            });
            // #endregion
        }
    }
    clampInt(value, min, max) {
        if (!Number.isFinite(value))
            return min;
        const rounded = Math.round(value);
        if (rounded < min)
            return min;
        if (rounded > max)
            return max;
        return rounded;
    }
    bindSttHandlers(recognizer) {
        recognizer.recognizing = (_sender, evt) => {
            const result = evt?.result;
            if (!result)
                return;
            const text = String(result.text ?? "").trim();
            const offsetMs = toMs(result.offset);
            const turnId = this.ensureTurn(offsetMs);
            const detected = this.resolveFromLang(result);
            const from = detected ?? this.lastFinalLang;
            this.lastPartialLang = from;
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
            if (!result)
                return;
            const reason = result.reason;
            if (reason !== sdk.ResultReason.RecognizedSpeech)
                return;
            const text = String(result.text ?? "").trim();
            if (!text)
                return;
            const offsetMs = toMs(result.offset);
            const durationMs = toMs(result.duration) ?? 0;
            const startMs = this.currentTurnStartMs ?? offsetMs ?? 0;
            const endMs = this.pendingEndMs ?? (offsetMs != null ? offsetMs + durationMs : startMs);
            const turnId = this.ensureTurn(startMs);
            const detected = this.resolveFromLang(result);
            const from = detected ?? this.lastFinalLang;
            if (detected)
                this.lastFinalLang = detected;
            // #region agent log
            debugLog({
                location: "azureSpeechSttAdapter.ts:recognized",
                message: "recognized speech result",
                data: {
                    turnId,
                    textLength: text.length,
                    from: from ?? null,
                    detected: detected ?? null,
                    lastFinalLang: this.lastFinalLang ?? null,
                    lastPartialLang: this.lastPartialLang ?? null,
                    startMs,
                    endMs,
                },
                timestamp: Date.now(),
                sessionId: "debug-session",
                runId: "run1",
                hypothesisId: "H2",
            });
            // #endregion
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
            const details = evt?.errorDetails ?? evt?.reason?.toString?.() ?? "Azure STT canceled";
            this.onError(new Error(details));
        };
        recognizer.sessionStopped = () => {
            this.flushOpenTurn();
        };
    }
    bindDiarizationHandlers(recognizer) {
        recognizer.transcribing = (_sender, evt) => {
            const result = evt?.result;
            if (!result)
                return;
            const speakerId = typeof result.speakerId === "string"
                ? String(result.speakerId)
                : undefined;
            if (!speakerId)
                return;
            const offsetMs = toMs(result.offset);
            this.noteSpeaker({ speakerId, offsetMs });
        };
        recognizer.transcribed = (_sender, evt) => {
            const result = evt?.result;
            if (!result)
                return;
            const speakerId = typeof result.speakerId === "string"
                ? String(result.speakerId)
                : undefined;
            if (!speakerId)
                return;
            const offsetMs = toMs(result.offset);
            this.noteSpeaker({ speakerId, offsetMs });
        };
        recognizer.canceled = (_sender, evt) => {
            const details = evt?.errorDetails ??
                evt?.reason?.toString?.() ??
                "Azure diarization canceled";
            this.onError(new Error(details));
        };
    }
    resolveFromLang(result) {
        let detected;
        let propertyLang;
        let autoLang;
        let resultLang;
        try {
            const autoProperty = sdk.PropertyId
                ?.SpeechServiceConnection_AutoDetectSourceLanguageResult;
            if (autoProperty != null) {
                propertyLang = result.properties.getProperty(autoProperty);
                detected = toLang(propertyLang);
            }
        }
        catch {
            // ignore
        }
        try {
            const auto = sdk.AutoDetectSourceLanguageResult.fromResult(result);
            autoLang = auto?.language;
            if (!detected)
                detected = toLang(autoLang);
        }
        catch {
            // ignore
        }
        if (!detected && typeof result.language === "string") {
            resultLang = result.language;
            detected = toLang(resultLang);
        }
        // #region agent log
        debugLog({
            location: "azureSpeechSttAdapter.ts:resolveFromLang",
            message: "resolved speech language",
            data: {
                propertyLang: propertyLang ?? null,
                autoLang: autoLang ?? null,
                resultLang: resultLang ?? null,
                detected: detected ?? null,
                lastFinalLang: this.lastFinalLang ?? null,
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            runId: "run1",
            hypothesisId: "H3",
        });
        // #endregion
        return detected;
    }
    ensureTurn(offsetMs) {
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
    resolveSpeakerIdForTurn(offsetMs) {
        if (!this.pendingSpeakerId)
            return undefined;
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
    noteSpeaker(args) {
        if (this.currentTurnId) {
            if (!this.currentSpeakerId) {
                this.currentSpeakerId = args.speakerId;
            }
            return;
        }
        this.pendingSpeakerId = args.speakerId;
        if (args.offsetMs != null)
            this.pendingSpeakerAtMs = args.offsetMs;
    }
    flushOpenTurn() {
        if (!this.currentTurnId)
            return;
        const startMs = this.currentTurnStartMs ?? 0;
        const endMs = this.pendingEndMs ?? startMs;
        const turnId = this.currentTurnId;
        if (this.lastPartialText) {
            this.emit({
                type: "stt.final",
                sessionId: this.sessionId,
                turnId,
                segmentId: turnId,
                lang: this.lastPartialLang ?? this.lastFinalLang,
                text: this.lastPartialText,
                startMs,
                endMs,
            });
            this.onSttEvent?.({
                kind: "final",
                turnId,
                segmentId: turnId,
                text: this.lastPartialText,
                lang: this.lastPartialLang ?? this.lastFinalLang,
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
    resetTurnState() {
        this.currentTurnId = null;
        this.currentTurnStartMs = null;
        this.pendingEndMs = null;
        this.currentSpeakerId = undefined;
        this.lastPartialText = "";
        this.lastPartialLang = undefined;
        // #region agent log
        debugLog({
            location: "azureSpeechSttAdapter.ts:resetTurnState",
            message: "reset turn state",
            data: {},
            timestamp: Date.now(),
            sessionId: "debug-session",
            runId: "run1",
            hypothesisId: "H2",
        });
        // #endregion
    }
    handleStartError(err) {
        this.state = "stopped";
        this.onError(err instanceof Error ? err : new Error(String(err)));
    }
}
