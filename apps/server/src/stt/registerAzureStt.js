import { base64ToUint8Array } from "../util/base64.js";
import { AzureSpeechSttAdapter } from "./azure/azureSpeechSttAdapter.js";
import { loadAzureSpeechConfig } from "./azure/config.js";
import { loadGroqConfig } from "../translate/groq/config.js";
import { groqTranslate, } from "../translate/groq/groqTranslate.js";
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
const DEFAULT_IDLE_STOP_MS = 30_000;
/**
 * Plug Azure Speech STT + MT into the WS server audio frame pipeline.
 *
 * Lifecycle:
 * - Adapters are created lazily on first audio frame per session.
 * - If a session goes idle (no frames) we stop and GC its adapter.
 * - Reconnect is handled by WS layer; emits will go to the "current" socket.
 */
export function registerAzureStt(ws) {
    const entries = new Map();
    const config = loadAzureSpeechConfig();
    const groqConfig = loadGroqConfig();
    function normalizeLangList(list) {
        const out = [];
        for (const item of list) {
            const next = item.trim().toLowerCase();
            if (!next)
                continue;
            if (!out.includes(next))
                out.push(next);
        }
        return out.length > 0 ? out : groqConfig.targetLangs;
    }
    function resolveTargetLangs(args) {
        if (args.targetLangs && args.targetLangs.length > 0)
            return normalizeLangList(args.targetLangs);
        if (args.langs)
            return normalizeLangList([args.langs.lang1, args.langs.lang2]);
        return normalizeLangList(groqConfig.targetLangs);
    }
    function ensureEntry(sessionId, hello) {
        const existing = entries.get(sessionId);
        if (existing)
            return existing;
        let entry;
        debugLog({
            location: "registerAzureStt.ts:ensureEntry",
            message: "initializing azure stt adapter",
            data: {
                sessionId,
                specialWords: hello.specialWords ?? [],
                specialWordsCount: hello.specialWords?.length ?? 0,
                specialWordsBoostIgnored: hello.specialWordsBoost ?? null,
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            runId: "run1",
            hypothesisId: "H4",
        });
        const adapter = new AzureSpeechSttAdapter({
            sessionId,
            config,
            specialWords: hello.specialWords,
            specialWordsBoost: hello.specialWordsBoost,
            emit: (msg) => {
                ws.emitToSession(sessionId, msg);
            },
            onError: (err) => {
                ws.emitToSession(sessionId, {
                    type: "server.error",
                    sessionId,
                    code: "stt_error",
                    message: err.message,
                    recoverable: true,
                });
            },
            onSttEvent: (evt) => {
                void handleSttEvent(entry, evt);
            },
        });
        adapter.start();
        entry = {
            sessionId,
            adapter,
            idleTimer: null,
            lastFrameAt: Date.now(),
            targetLangs: resolveTargetLangs(hello),
            staticContext: hello.staticContext ?? groqConfig.staticContext,
            specialWords: hello.specialWords,
            specialWordsBoost: hello.specialWordsBoost,
            summary: "",
            history: [],
            revisionByKey: new Map(),
            partialByKey: new Map(),
            latestSeqByTurn: new Map(),
            translateSeq: 0,
            finalizedTurns: new Set(),
            inFlightTranslateCount: 0,
        };
        entries.set(sessionId, entry);
        return entry;
    }
    function scheduleIdleStop(sessionId, entry) {
        if (entry.idleTimer)
            clearTimeout(entry.idleTimer);
        entry.idleTimer = setTimeout(() => {
            const cur = entries.get(sessionId);
            if (!cur)
                return;
            const idleFor = Date.now() - cur.lastFrameAt;
            if (idleFor < DEFAULT_IDLE_STOP_MS) {
                scheduleIdleStop(sessionId, cur);
                return;
            }
            void cur.adapter.stop({ reason: "idle_timeout" });
            entries.delete(sessionId);
        }, DEFAULT_IDLE_STOP_MS);
    }
    const unsubscribe = ws.registerAudioFrameConsumer(({ session, frame }) => {
        const entry = ensureEntry(session.id, session.hello);
        entry.lastFrameAt = Date.now();
        scheduleIdleStop(session.id, entry);
        const pcm16 = base64ToUint8Array(frame.pcm16Base64);
        entry.adapter.pushAudioFrame({ pcm16, sampleRateHz: frame.sampleRateHz });
    });
    const unsubscribeStop = ws.registerSessionStopConsumer(({ sessionId, reason }) => {
        const entry = entries.get(sessionId);
        if (!entry)
            return;
        if (entry.idleTimer)
            clearTimeout(entry.idleTimer);
        void entry.adapter.stop({ reason: reason ?? "client_stop" });
        entries.delete(sessionId);
    });
    return () => {
        unsubscribe();
        unsubscribeStop();
        for (const [sessionId, entry] of entries) {
            if (entry.idleTimer)
                clearTimeout(entry.idleTimer);
            void entry.adapter.stop({ reason: "server_shutdown" });
            entries.delete(sessionId);
        }
    };
    async function handleSttEvent(entry, evt) {
        const text = evt.text.trim();
        if (!text)
            return;
        if (evt.kind === "partial" && entry.finalizedTurns.has(evt.turnId))
            return;
        if (evt.kind === "partial" && entry.inFlightTranslateCount > 0)
            return;
        const seq = ++entry.translateSeq;
        entry.latestSeqByTurn.set(evt.turnId, seq);
        const previousPartial = buildPreviousPartial(entry, evt.turnId);
        let result;
        entry.inFlightTranslateCount += 1;
        try {
            // #region agent log
            debugLog({
                location: "registerAzureStt.ts:preTranslate",
                message: "calling groqTranslate",
                data: {
                    kind: evt.kind,
                    lang: evt.lang ?? null,
                    textLen: text.length,
                    targetLangs: entry.targetLangs,
                    summaryLen: entry.summary.length,
                    historyLen: entry.history.length,
                },
                timestamp: Date.now(),
                sessionId: "debug-session",
                runId: "run1",
                hypothesisId: "H1",
            });
            // #endregion
            result = await groqTranslate(groqConfig, {
                utteranceText: text,
                isFinal: evt.kind === "final",
                utteranceLang: evt.lang,
                targetLangs: entry.targetLangs,
                history: entry.history.slice(-10),
                summary: entry.summary,
                staticContext: entry.staticContext,
                previousPartial: evt.kind === "partial" ? previousPartial : {},
            });
        }
        catch (err) {
            ws.emitToSession(entry.sessionId, {
                type: "server.error",
                sessionId: entry.sessionId,
                code: "translate_error",
                message: err instanceof Error ? err.message : String(err),
                recoverable: true,
            });
            return;
        }
        finally {
            entry.inFlightTranslateCount = Math.max(0, entry.inFlightTranslateCount - 1);
        }
        if (evt.kind === "partial" && entry.latestSeqByTurn.get(evt.turnId) !== seq)
            return;
        // #region agent log
        debugLog({
            location: "registerAzureStt.ts:postTranslate",
            message: "groqTranslate result",
            data: {
                kind: evt.kind,
                lang: evt.lang ?? null,
                translationKeys: Object.keys(result.translations ?? {}),
                summaryLen: typeof result.summary === "string" ? result.summary.length : 0,
            },
            timestamp: Date.now(),
            sessionId: "debug-session",
            runId: "run1",
            hypothesisId: "H1",
        });
        // #endregion
        const sourceLang = result.sourceLang;
        const fromLang = (evt.lang ?? "und");
        const translations = {};
        for (const lang of entry.targetLangs) {
            const key = lang.toLowerCase();
            const translated = result.translations[key] ??
                result.translations[key.toUpperCase()] ??
                (key === fromLang ? text : "");
            if (!translated)
                continue;
            translations[key] = translated;
            if (evt.kind === "partial") {
                const revKey = `${evt.turnId}:${key}`;
                const nextRev = (entry.revisionByKey.get(revKey) ?? 0) + 1;
                entry.revisionByKey.set(revKey, nextRev);
                entry.partialByKey.set(revKey, translated);
                const emitted = ws.emitToSession(entry.sessionId, {
                    type: "translate.revise",
                    sessionId: entry.sessionId,
                    turnId: evt.turnId,
                    segmentId: evt.segmentId,
                    from: fromLang,
                    to: key,
                    revision: nextRev,
                    fullText: translated,
                    sourceLang,
                });
                // #region agent log
                debugLog({
                    location: "registerAzureStt.ts:emitTranslate",
                    message: "translate.revise emitted",
                    data: { to: key, emitted, translationLen: translated.length },
                    timestamp: Date.now(),
                    sessionId: "debug-session",
                    runId: "run1",
                    hypothesisId: "H4",
                });
                // #endregion
            }
            else {
                const emitted = ws.emitToSession(entry.sessionId, {
                    type: "translate.final",
                    sessionId: entry.sessionId,
                    turnId: evt.turnId,
                    segmentId: evt.segmentId,
                    from: fromLang,
                    to: key,
                    text: translated,
                    sourceLang,
                });
                // #region agent log
                debugLog({
                    location: "registerAzureStt.ts:emitTranslate",
                    message: "translate.final emitted",
                    data: { to: key, emitted, translationLen: translated.length },
                    timestamp: Date.now(),
                    sessionId: "debug-session",
                    runId: "run1",
                    hypothesisId: "H4",
                });
                // #endregion
            }
        }
        if (evt.kind === "final") {
            entry.finalizedTurns.add(evt.turnId);
            entry.history.push({
                text,
                lang: sourceLang ?? evt.lang,
                translations,
            });
            if (entry.history.length > 10)
                entry.history.splice(0, entry.history.length - 10);
            if (typeof result.summary === "string" && result.summary.trim()) {
                entry.summary = result.summary.trim();
                const emitted = ws.emitToSession(entry.sessionId, {
                    type: "summary.update",
                    sessionId: entry.sessionId,
                    summary: entry.summary,
                });
                // #region agent log
                debugLog({
                    location: "registerAzureStt.ts:emitSummary",
                    message: "summary.update emitted",
                    data: {
                        emitted,
                        summaryLen: entry.summary.length,
                        summaryTrimLen: entry.summary.trim().length,
                    },
                    timestamp: Date.now(),
                    sessionId: "debug-session",
                    runId: "run1",
                    hypothesisId: "H2",
                });
                // #endregion
            }
        }
        if (evt.kind === "final") {
            clearTurnPartials(entry, evt.turnId);
        }
    }
    function buildPreviousPartial(entry, turnId) {
        const result = {};
        for (const lang of entry.targetLangs) {
            const key = lang.toLowerCase();
            const existing = entry.partialByKey.get(`${turnId}:${key}`);
            if (existing && existing.trim().length > 0) {
                result[key] = existing;
            }
        }
        return result;
    }
    function clearTurnPartials(entry, turnId) {
        for (const lang of entry.targetLangs) {
            entry.partialByKey.delete(`${turnId}:${lang.toLowerCase()}`);
        }
    }
}
