import type { Lang, ServerToClientMessage } from "@livetranslate/shared";
import { PROTOCOL_VERSION } from "@livetranslate/shared";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type Segment = {
  segmentId: string;
  lang: Lang;
  startMs: number;
  endMs?: number;
  text: string;
  isFinal: boolean;
};

export type Turn = {
  turnId: string;
  sessionId?: string;
  speakerId?: string;
  startMs?: number;
  endMs?: number;
  isFinal: boolean;
  segmentsById: Record<string, Segment>;
  segmentOrder: string[];
};

export type TranscriptState = {
  protocolVersion: number;
  url: string;
  status: ConnectionStatus;
  sessionId?: string;
  lastSocketError?: string;
  lastServerError?: string;
  turnsById: Record<string, Turn>;
  turnOrder: string[];
};

export type TranscriptAction =
  | { type: "connection.update"; status: ConnectionStatus; error?: string }
  | { type: "server.message"; message: ServerToClientMessage }
  | { type: "transcript.reset" }
  | { type: "url.set"; url: string };

export const DEFAULT_WS_URL = "ws://localhost:8787";

function getDefaultWsUrl() {
  const fromEnv = import.meta.env.VITE_WS_URL;
  return typeof fromEnv === "string" && fromEnv.length > 0 ? fromEnv : DEFAULT_WS_URL;
}

export function makeInitialState(): TranscriptState {
  return {
    protocolVersion: PROTOCOL_VERSION,
    url: getDefaultWsUrl(),
    status: "idle",
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
        return { ...state, sessionId: msg.sessionId, lastServerError: undefined };
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
        const lang: Lang = msg.lang ?? "de";
        const nextState = ensureTurn(state, msg.turnId, {
          sessionId: msg.sessionId,
          startMs: state.turnsById[msg.turnId]?.startMs ?? msg.startMs,
        });
        const turn = nextState.turnsById[msg.turnId];
        const prevSeg = turn.segmentsById[msg.segmentId];

        // If we already finalized this segment, ignore any later partials.
        if (prevSeg?.isFinal && msg.type === "stt.partial") return nextState;

        const seg: Segment = {
          segmentId: msg.segmentId,
          lang,
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
          turnsById: { ...nextState.turnsById, [msg.turnId]: updatedTurn },
        };
      }

      // Translation events exist in the protocol, but Milestone 1 stubs them out.
      return state;
    }
  }
}

