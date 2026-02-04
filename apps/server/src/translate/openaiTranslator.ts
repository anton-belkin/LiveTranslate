import type { Lang, SttFinal, SttPartial } from "@livetranslate/shared";
import type { WsServerApi } from "../ws/server.js";
import { getTranslateTargetLang, openaiDetectLangDeEn, openaiTranslateStream } from "./openaiTranslate.js";

const DEFAULT_TRANSLATE_MODEL = "gpt-4o-mini";

const DRAFT_MIN_NEW_CHARS = 12;
const DRAFT_MIN_INTERVAL_MS = 700;

function isLang(x: unknown): x is Lang {
  return x === "de" || x === "en";
}

function heuristicDetectLangDeEn(text: string): Lang | null {
  const t = text.toLowerCase();
  if (/[äöüß]/i.test(text)) return "de";
  // quick word hits (very rough; only used when STT didn't provide lang)
  const deHits = [" und ", " nicht ", " ich ", " wir ", " der ", " die ", " das ", " ein ", " eine ", " ist "];
  const enHits = [" the ", " and ", " not ", " i ", " we ", " you ", " is ", " are ", " a ", " an "];
  const padded = ` ${t.replace(/\s+/g, " ").trim()} `;
  const deScore = deHits.reduce((acc, w) => acc + (padded.includes(w) ? 1 : 0), 0);
  const enScore = enHits.reduce((acc, w) => acc + (padded.includes(w) ? 1 : 0), 0);
  if (deScore > enScore && deScore >= 2) return "de";
  if (enScore > deScore && enScore >= 2) return "en";
  return null;
}

type TurnKey = `${string}:${string}`; // `${sessionId}:${turnId}`

export function createOpenAiTranslator(ws: WsServerApi) {
  const inFlight = new Map<TurnKey, AbortController>();
  const pendingTimers = new Map<TurnKey, NodeJS.Timeout>();
  const lastDraftByTurn = new Map<TurnKey, string>();
  const lastRequestedAtByTurn = new Map<TurnKey, number>();
  const lastRequestedLenByTurn = new Map<TurnKey, number>();
  const revisionByTurn = new Map<TurnKey, number>();

  function abortKey(key: TurnKey) {
    const cur = inFlight.get(key);
    if (!cur) return;
    try {
      cur.abort();
    } catch {
      // ignore
    }
    inFlight.delete(key);
  }

  function clearPendingTimer(key: TurnKey) {
    const t = pendingTimers.get(key);
    if (!t) return;
    clearTimeout(t);
    pendingTimers.delete(key);
  }

  function abortSession(sessionId: string) {
    for (const [key, ctrl] of inFlight) {
      if (!key.startsWith(`${sessionId}:`)) continue;
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
      inFlight.delete(key);
    }

    for (const [key, t] of pendingTimers) {
      if (!key.startsWith(`${sessionId}:`)) continue;
      clearTimeout(t);
      pendingTimers.delete(key);
    }

    for (const key of lastDraftByTurn.keys()) {
      if (!key.startsWith(`${sessionId}:`)) continue;
      lastDraftByTurn.delete(key);
      lastRequestedAtByTurn.delete(key);
      lastRequestedLenByTurn.delete(key);
      revisionByTurn.delete(key);
    }
  }

  async function detectFromLang(args: { text: string; lang?: Lang }): Promise<Lang | null> {
    if (args.lang && isLang(args.lang)) return args.lang;
    const h = heuristicDetectLangDeEn(args.text);
    if (h) return h;

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    try {
      return await openaiDetectLangDeEn({
        apiKey,
        model: process.env.OPENAI_TRANSLATE_MODEL ?? DEFAULT_TRANSLATE_MODEL,
        text: args.text,
      });
    } catch {
      return null;
    }
  }

  function nextRevision(key: TurnKey) {
    const prev = revisionByTurn.get(key) ?? 0;
    const next = prev + 1;
    revisionByTurn.set(key, next);
    return next;
  }

  async function translateWithRevise(args: {
    key: TurnKey;
    sessionId: string;
    turnId: string;
    segmentId: string;
    from: Lang;
    to: Lang;
    text: string;
    emitFinal: boolean;
  }) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return;

    clearPendingTimer(args.key);
    abortKey(args.key);
    const ctrl = new AbortController();
    inFlight.set(args.key, ctrl);

    const revision = nextRevision(args.key);
    let full = "";

    const emitRevise = (fullText: string) => {
      ws.emitToSession(args.sessionId, {
        type: "translate.revise",
        sessionId: args.sessionId,
        turnId: args.turnId,
        segmentId: args.segmentId,
        from: args.from,
        to: args.to,
        revision,
        fullText,
      });
    };

    try {
      await openaiTranslateStream({
        apiKey,
        model: process.env.OPENAI_TRANSLATE_MODEL ?? DEFAULT_TRANSLATE_MODEL,
        from: args.from,
        to: args.to,
        text: args.text,
        signal: ctrl.signal,
        onDelta(textDelta) {
          full += textDelta;
        },
        onFinal(finalText) {
          full = finalText;
        },
      });

      // UX: atomic replace. Emit a single snapshot only after the translation is fully received.
      emitRevise(full);

      if (args.emitFinal) {
        ws.emitToSession(args.sessionId, {
          type: "translate.final",
          sessionId: args.sessionId,
          turnId: args.turnId,
          segmentId: args.segmentId,
          from: args.from,
          to: args.to,
          text: full,
        });
      }
    } catch (err) {
      const e = err as any;
      const name = typeof e?.name === "string" ? e.name : "";
      // Ignore aborts (session stop / superseded translation)
      if (name === "AbortError") return;

      ws.emitToSession(args.sessionId, {
        type: "server.error",
        sessionId: args.sessionId,
        code: "translate_error",
        message: err instanceof Error ? err.message : String(err),
        recoverable: true,
      });
    } finally {
      const cur = inFlight.get(args.key);
      if (cur === ctrl) inFlight.delete(args.key);
    }
  }

  function shouldTranslateDraftNow(key: TurnKey, nextText: string) {
    const now = Date.now();
    const lastAt = lastRequestedAtByTurn.get(key) ?? 0;
    const lastLen = lastRequestedLenByTurn.get(key) ?? 0;
    const deltaChars = Math.max(0, nextText.length - lastLen);
    const dueByChars = deltaChars >= DRAFT_MIN_NEW_CHARS;
    const dueByTime = now - lastAt >= DRAFT_MIN_INTERVAL_MS;
    return dueByChars || dueByTime;
  }

  function scheduleDraftTranslate(args: {
    key: TurnKey;
    sessionId: string;
    turnId: string;
    segmentId: string;
    from: Lang;
    to: Lang;
  }) {
    clearPendingTimer(args.key);
    const now = Date.now();
    const lastAt = lastRequestedAtByTurn.get(args.key) ?? 0;
    const waitMs = Math.max(0, DRAFT_MIN_INTERVAL_MS - (now - lastAt));
    const t = setTimeout(() => {
      pendingTimers.delete(args.key);
      const text = lastDraftByTurn.get(args.key);
      if (!text) return;
      lastRequestedAtByTurn.set(args.key, Date.now());
      lastRequestedLenByTurn.set(args.key, text.length);
      void translateWithRevise({
        key: args.key,
        sessionId: args.sessionId,
        turnId: args.turnId,
        segmentId: args.segmentId,
        from: args.from,
        to: args.to,
        text,
        emitFinal: false,
      });
    }, waitMs);
    pendingTimers.set(args.key, t);
  }

  async function onSttPartial(msg: SttPartial): Promise<void> {
    if (msg.segmentId !== msg.turnId) return;
    const text = String(msg.text ?? "").trim();
    if (!text) return;

    const key: TurnKey = `${msg.sessionId}:${msg.turnId}`;

    // Abort any in-flight translation for this turn; we only want latest draft.
    abortKey(key);
    clearPendingTimer(key);

    // If draft didn't change, no-op.
    const prevDraft = lastDraftByTurn.get(key);
    if (prevDraft === text) return;
    lastDraftByTurn.set(key, text);

    const from = await detectFromLang({ text, lang: msg.lang });
    if (!from) return;
    const to = getTranslateTargetLang(from);

    if (shouldTranslateDraftNow(key, text)) {
      lastRequestedAtByTurn.set(key, Date.now());
      lastRequestedLenByTurn.set(key, text.length);
      void translateWithRevise({
        key,
        sessionId: msg.sessionId,
        turnId: msg.turnId,
        segmentId: msg.segmentId,
        from,
        to,
        text,
        emitFinal: false,
      });
      return;
    }

    // Debounced: still ensure we eventually translate the latest draft.
    scheduleDraftTranslate({
      key,
      sessionId: msg.sessionId,
      turnId: msg.turnId,
      segmentId: msg.segmentId,
      from,
      to,
    });
  }

  async function onSttFinal(msg: SttFinal): Promise<void> {
    if (msg.segmentId !== msg.turnId) return;
    const text = String(msg.text ?? "").trim();
    if (!text) return;

    const from = await detectFromLang({ text, lang: msg.lang });
    if (!from) return;
    const to = getTranslateTargetLang(from);

    const key: TurnKey = `${msg.sessionId}:${msg.turnId}`;
    lastDraftByTurn.delete(key);
    clearPendingTimer(key);
    abortKey(key);

    await translateWithRevise({
      key,
      sessionId: msg.sessionId,
      turnId: msg.turnId,
      segmentId: msg.segmentId,
      from,
      to,
      text,
      emitFinal: true,
    });
  }

  return { onSttPartial, onSttFinal, abortSession };
}

