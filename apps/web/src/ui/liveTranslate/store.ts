import type { Lang, ServerToClientMessage } from "@livetranslate/shared";
import { PROTOCOL_VERSION } from "@livetranslate/shared";
import { parseUrlConfig } from "./urlConfig";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type Segment = {
  segmentId: string;
  lang?: Lang;
  startMs: number;
  endMs?: number;
  text: string;
  isFinal: boolean;
};

export type TurnTranslation = {
  segmentId: string;
  from: Lang;
  to: Lang;
  text: string;
  isFinal: boolean;
  sourceLang?: Lang;
  /**
   * Used only to ignore duplicate `translate.partial` deltas.
   */
  lastDelta?: string;
};

export type Turn = {
  turnId: string;
  sessionId?: string;
  speakerId?: string;
  /**
   * Turn language derived from `stt.*.lang` when `segmentId === turnId`.
   * Missing/unknown stays undefined.
   */
  lang?: Lang;
  startMs?: number;
  endMs?: number;
  isFinal: boolean;
  segmentsById: Record<string, Segment>;
  segmentOrder: string[];
  translationsByLang: Record<string, TurnTranslation>;
};

export type TranscriptState = {
  protocolVersion: number;
  url: string;
  status: ConnectionStatus;
  sessionId?: string;
  lastSocketError?: string;
  lastServerError?: string;
  summary?: string;
  targetLangs: Lang[];
  turnsById: Record<string, Turn>;
  turnOrder: string[];
};

export type TranscriptAction =
  | { type: "connection.update"; status: ConnectionStatus; error?: string }
  | { type: "server.message"; message: ServerToClientMessage }
  | { type: "transcript.reset" }
  | { type: "transcript.stopFinalize" }
  | { type: "url.set"; url: string };

export const DEFAULT_WS_URL = "ws://localhost:8787";

function getDefaultWsUrl() {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv;
  if (typeof window !== "undefined" && window.location) {
    if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
      const devUrl = "ws://localhost:8787";
      return devUrl;
    }
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const computedUrl = `${wsProtocol}//${window.location.host}/ws`;
    return computedUrl;
  }
  return DEFAULT_WS_URL;
}

export function makeInitialState(): TranscriptState {
  const urlConfig = typeof window !== "undefined" ? parseUrlConfig() : undefined;
  return {
    protocolVersion: PROTOCOL_VERSION,
    url: getDefaultWsUrl(),
    status: "idle",
    summary: undefined,
    targetLangs: urlConfig?.targetLangs ?? [],
    turnsById: {},
    turnOrder: [],
  };
}

function ensureTurn(
  state: TranscriptState,
  turnId: string,
  patch?: Partial<Turn>,
): TranscriptState {
  const existing = state.turnsById[turnId];
  if (existing) {
    if (!patch) return state;
    const updated: Turn = { ...existing, ...patch };
    return {
      ...state,
      turnsById: { ...state.turnsById, [turnId]: updated },
    };
  }

  const created: Turn = {
    turnId,
    isFinal: false,
    segmentsById: {},
    segmentOrder: [],
    translationsByLang: {},
    ...patch,
  };

  return {
    ...state,
    turnsById: { ...state.turnsById, [turnId]: created },
    turnOrder: [...state.turnOrder, turnId],
  };
}

function insertSegmentIdByStart(
  order: string[],
  segmentsById: Record<string, Segment>,
  segmentId: string,
  startMs: number,
) {
  if (order.length === 0) return [segmentId];

  // Insert once (segment ordering doesn't change after first sighting).
  let idx = order.length;
  for (let i = 0; i < order.length; i += 1) {
    const other = segmentsById[order[i]];
    if (!other) continue;
    if (startMs < other.startMs) {
      idx = i;
      break;
    }
  }
  return [...order.slice(0, idx), segmentId, ...order.slice(idx)];
}

function upsertSegment(
  turn: Turn,
  seg: Segment,
  insertIfNew: boolean,
): Turn {
  const prev = turn.segmentsById[seg.segmentId];
  const nextSegmentsById = { ...turn.segmentsById, [seg.segmentId]: seg };

  let nextOrder = turn.segmentOrder;
  if (!prev && insertIfNew) {
    nextOrder = insertSegmentIdByStart(
      turn.segmentOrder,
      nextSegmentsById,
      seg.segmentId,
      seg.startMs,
    );
  }

  return {
    ...turn,
    segmentsById: nextSegmentsById,
    segmentOrder: nextOrder,
  };
}

export function transcriptReducer(
  state: TranscriptState,
  action: TranscriptAction,
): TranscriptState {
  switch (action.type) {
    case "url.set":
      return { ...state, url: action.url };

    case "transcript.reset":
      return {
        ...makeInitialState(),
        url: state.url,
      };

    case "transcript.stopFinalize": {
      let changed = false;
      const nextTurns: Record<string, Turn> = {};

      const appendEllipsis = (text: string) => {
        const trimmed = text.trimEnd();
        if (!trimmed) return text;
        if (trimmed.endsWith("...")) return trimmed;
        return `${trimmed}...`;
      };

      for (const [turnId, turn] of Object.entries(state.turnsById)) {
        let turnChanged = false;
        let segmentsById = turn.segmentsById;
        let translationsByLang = turn.translationsByLang;

        for (const segmentId of turn.segmentOrder) {
          const seg = segmentsById[segmentId];
          if (!seg || seg.isFinal) continue;
          const nextText = appendEllipsis(seg.text);
          if (nextText !== seg.text || !seg.isFinal) {
            if (!turnChanged) segmentsById = { ...segmentsById };
            segmentsById[segmentId] = { ...seg, text: nextText, isFinal: true };
            turnChanged = true;
            changed = true;
          }
        }

        for (const [lang, translation] of Object.entries(translationsByLang)) {
          if (!translation || translation.isFinal) continue;
          const nextText = appendEllipsis(translation.text);
          if (nextText !== translation.text || !translation.isFinal) {
            if (!turnChanged) translationsByLang = { ...translationsByLang };
            translationsByLang[lang] = { ...translation, text: nextText, isFinal: true };
            turnChanged = true;
            changed = true;
          }
        }

        if (turnChanged) {
          nextTurns[turnId] = { ...turn, segmentsById, translationsByLang };
        }
      }

      if (!changed) return state;
      return {
        ...state,
        turnsById: { ...state.turnsById, ...nextTurns },
      };
    }

    case "connection.update":
      return {
        ...state,
        status: action.status,
        lastSocketError: action.error,
        ...(action.status === "idle" ? { lastServerError: undefined } : null),
      };

    case "server.message": {
      const msg = action.message;

      if (msg.type === "server.ready") {
        return {
          ...state,
          sessionId: msg.sessionId,
          lastServerError: undefined,
          targetLangs: msg.targetLangs ?? state.targetLangs,
        };
      }

      if (msg.type === "server.error") {
        return {
          ...state,
          lastServerError: `${msg.code}: ${msg.message}`,
        };
      }

      if (msg.type === "turn.start") {
        return ensureTurn(state, msg.turnId, {
          sessionId: msg.sessionId,
          speakerId: msg.speakerId,
          startMs: msg.startMs,
        });
      }

      if (msg.type === "turn.final") {
        const next = ensureTurn(state, msg.turnId, {
          sessionId: msg.sessionId,
          speakerId: msg.speakerId,
          startMs: msg.startMs,
          endMs: msg.endMs,
          isFinal: true,
        });
        return next;
      }

      if (msg.type === "stt.partial" || msg.type === "stt.final") {
        const lang: Lang | undefined = msg.lang;
        const nextState = ensureTurn(state, msg.turnId, {
          sessionId: msg.sessionId,
          startMs: state.turnsById[msg.turnId]?.startMs ?? msg.startMs,
        });
        const turn = nextState.turnsById[msg.turnId];
        const prevSeg = turn.segmentsById[msg.segmentId];

        // If we already finalized this segment, ignore any later partials.
        if (prevSeg?.isFinal && msg.type === "stt.partial") return nextState;

        const nextTurnLang =
          msg.segmentId === msg.turnId && lang ? lang : turn.lang;

        const seg: Segment = {
          segmentId: msg.segmentId,
          lang: lang ?? prevSeg?.lang,
          startMs: msg.startMs,
          endMs:
            msg.type === "stt.final" ? msg.endMs : prevSeg?.isFinal ? prevSeg.endMs : undefined,
          text: msg.text,
          isFinal: msg.type === "stt.final" ? true : prevSeg?.isFinal ?? false,
        };

        // Avoid re-render churn on duplicate partials.
        if (
          prevSeg &&
          prevSeg.text === seg.text &&
          prevSeg.isFinal === seg.isFinal &&
          prevSeg.endMs === seg.endMs &&
          prevSeg.startMs === seg.startMs &&
          prevSeg.lang === seg.lang
        ) {
          return nextState;
        }

        const updatedTurn = upsertSegment(turn, seg, true);

        return {
          ...nextState,
          turnsById: {
            ...nextState.turnsById,
            [msg.turnId]: { ...updatedTurn, lang: nextTurnLang },
          },
        };
      }

      if (msg.type === "translate.partial") {
        // Scope: stitched translation only.
        if (msg.segmentId !== msg.turnId) return state;
        if (msg.textDelta.length === 0) return state;

        const nextState = ensureTurn(state, msg.turnId, {
          sessionId: msg.sessionId,
        });
        const turn = nextState.turnsById[msg.turnId];
        const prev = turn.translationsByLang[msg.to];

        // Ignore exact duplicate deltas.
        if (prev && prev.segmentId === msg.segmentId && prev.from === msg.from && prev.lastDelta === msg.textDelta) {
          return nextState;
        }

        const nextText =
          prev && prev.segmentId === msg.segmentId && prev.from === msg.from
            ? prev.text + msg.textDelta
            : msg.textDelta;

        if (prev?.text === nextText && prev.isFinal === false) return nextState;

        const updatedTurn: Turn = {
          ...turn,
          translationsByLang: {
            ...turn.translationsByLang,
            [msg.to]: {
              segmentId: msg.segmentId,
              from: msg.from,
              to: msg.to,
              text: nextText,
              isFinal: false,
              sourceLang: msg.sourceLang ?? prev?.sourceLang,
              lastDelta: msg.textDelta,
            },
          },
        };

        return {
          ...nextState,
          turnsById: { ...nextState.turnsById, [msg.turnId]: updatedTurn },
        };
      }

      if (msg.type === "translate.final") {
        // Scope: stitched translation only.
        if (msg.segmentId !== msg.turnId) return state;

        const nextState = ensureTurn(state, msg.turnId, {
          sessionId: msg.sessionId,
        });
        const turn = nextState.turnsById[msg.turnId];
        const prev = turn.translationsByLang[msg.to];

        if (prev && prev.segmentId === msg.segmentId && prev.from === msg.from && prev.text === msg.text && prev.isFinal) {
          return nextState;
        }

        const updatedTurn: Turn = {
          ...turn,
          translationsByLang: {
            ...turn.translationsByLang,
            [msg.to]: {
              segmentId: msg.segmentId,
              from: msg.from,
              to: msg.to,
              text: msg.text,
              isFinal: true,
              sourceLang: msg.sourceLang ?? prev?.sourceLang,
            },
          },
        };

        return {
          ...nextState,
          turnsById: { ...nextState.turnsById, [msg.turnId]: updatedTurn },
        };
      }

      if (msg.type === "translate.revise") {
        // Scope: stitched translation only.
        if (msg.segmentId !== msg.turnId) return state;

        const nextState = ensureTurn(state, msg.turnId, {
          sessionId: msg.sessionId,
        });
        const turn = nextState.turnsById[msg.turnId];
        const prev = turn.translationsByLang[msg.to];

        if (prev && prev.segmentId === msg.segmentId && prev.from === msg.from && prev.text === msg.fullText && prev.isFinal === false) {
          return nextState;
        }

        const updatedTurn: Turn = {
          ...turn,
          translationsByLang: {
            ...turn.translationsByLang,
            [msg.to]: {
              segmentId: msg.segmentId,
              from: msg.from,
              to: msg.to,
              text: msg.fullText,
              isFinal: false,
              sourceLang: msg.sourceLang ?? prev?.sourceLang,
            },
          },
        };

        return {
          ...nextState,
          turnsById: { ...nextState.turnsById, [msg.turnId]: updatedTurn },
        };
      }

      if (msg.type === "summary.update") {
        if (msg.summary === state.summary) return state;
        return { ...state, summary: msg.summary };
      }

      return state;
    }
  }
}

