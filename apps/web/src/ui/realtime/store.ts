import type { Lang } from "@livetranslate/shared";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type Segment = {
  segmentId: string;
  /**
   * Realtime transcription segment has `item_id` (user audio item).
   * We treat it as a coarse container for timing/ordering only.
   */
  itemId?: string;
  speakerId?: string;

  t0Ms?: number;
  t1Ms?: number;

  sourceText: string;
  sourceLang?: Lang;

  /**
   * Incremented on any meaningful change (text/timing/speaker/lang).
   * Used to drop stale translation patches.
   */
  rev: number;

  firstSeenAtMs: number;
  updatedAtMs: number;

  /**
   * Translation texts keyed by language.
   * (Keeps us ready for 3–4 columns later.)
   */
  translationsByLang: Partial<Record<Lang, string>>;
};

export type TranscriptState = {
  status: ConnectionStatus;
  lastError?: string;

  /**
   * Which languages are rendered as columns.
   * For now: ["de","en"].
   */
  columnLangs: Lang[];

  /**
   * Input audio item start/end times from VAD events, in ms since session audio start.
   * Used to convert segment (start/end seconds) into absolute ms.
   */
  itemStartMsById: Record<string, number>;
  itemEndMsById: Record<string, number>;

  segmentsById: Record<string, Segment>;
};

export type OpenAiRealtimeEvent = Record<string, any> & { type?: string };

export type TranscriptAction =
  | { type: "conn.update"; status: ConnectionStatus; error?: string }
  | { type: "realtime.event"; event: OpenAiRealtimeEvent }
  | { type: "translation.patch"; patch: { segmentId: string; targetLang: Lang; targetText: string; sourceRev: number } }
  | { type: "transcript.reset" };

export function makeInitialState(): TranscriptState {
  return {
    status: "idle",
    columnLangs: ["de", "en"],
    itemStartMsById: {},
    itemEndMsById: {},
    segmentsById: {},
  };
}

function computeAbsMs(args: {
  itemId?: string;
  itemStartMsById: Record<string, number>;
  seconds?: number;
}): number | undefined {
  if (!args.itemId) return undefined;
  if (typeof args.seconds !== "number" || !Number.isFinite(args.seconds)) return undefined;
  const base = args.itemStartMsById[args.itemId];
  if (typeof base !== "number") return undefined;
  return Math.floor(base + args.seconds * 1000);
}

function detectDeEnHeuristic(text: string): Lang | undefined {
  const t = text.trim();
  if (t.length < 12) return undefined;
  if (/[äöüß]/i.test(t)) return "de";
  const lower = ` ${t.toLowerCase().replace(/\s+/g, " ").trim()} `;
  const deHits = [" und ", " ich ", " nicht ", " das ", " ist ", " wir ", " sie ", " aber "];
  const enHits = [" the ", " and ", " i ", " you ", " not ", " this ", " that ", " we ", " but "];
  const deScore = deHits.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
  const enScore = enHits.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
  if (deScore >= 2 && deScore > enScore) return "de";
  if (enScore >= 2 && enScore > deScore) return "en";
  return undefined;
}

export function transcriptReducer(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.type) {
    case "transcript.reset":
      return makeInitialState();

    case "conn.update":
      return { ...state, status: action.status, lastError: action.error };

    case "translation.patch": {
      const seg = state.segmentsById[action.patch.segmentId];
      if (!seg) return state;
      if (seg.rev !== action.patch.sourceRev) return state; // stale patch
      const prev = seg.translationsByLang[action.patch.targetLang];
      if (prev === action.patch.targetText) return state;
      const updated: Segment = {
        ...seg,
        translationsByLang: { ...seg.translationsByLang, [action.patch.targetLang]: action.patch.targetText },
      };
      return { ...state, segmentsById: { ...state.segmentsById, [seg.segmentId]: updated } };
    }

    case "realtime.event": {
      const e = action.event;
      const t = typeof e?.type === "string" ? e.type : "";

      if (t === "error") {
        const msg = typeof e?.error?.message === "string" ? e.error.message : "Realtime error";
        return { ...state, lastError: msg };
      }

      if (t === "input_audio_buffer.speech_started") {
        const itemId = String(e.item_id ?? "");
        const startMs = Number(e.audio_start_ms);
        if (!itemId || !Number.isFinite(startMs)) return state;
        if (state.itemStartMsById[itemId] === startMs) return state;
        return { ...state, itemStartMsById: { ...state.itemStartMsById, [itemId]: startMs } };
      }

      if (t === "input_audio_buffer.speech_stopped") {
        const itemId = String(e.item_id ?? "");
        const endMs = Number(e.audio_end_ms);
        if (!itemId || !Number.isFinite(endMs)) return state;
        if (state.itemEndMsById[itemId] === endMs) return state;
        return { ...state, itemEndMsById: { ...state.itemEndMsById, [itemId]: endMs } };
      }

      if (t === "conversation.item.input_audio_transcription.segment") {
        const segmentId = String(e.id ?? "");
        if (!segmentId) return state;
        const itemId = typeof e.item_id === "string" ? e.item_id : undefined;
        const speakerId = typeof e.speaker === "string" ? e.speaker : undefined;
        const text = typeof e.text === "string" ? e.text : "";

        const t0Ms = computeAbsMs({ itemId, itemStartMsById: state.itemStartMsById, seconds: Number(e.start) });
        const t1Ms = computeAbsMs({ itemId, itemStartMsById: state.itemStartMsById, seconds: Number(e.end) });
        const now = Date.now();

        const prev = state.segmentsById[segmentId];
        if (!prev) {
          const sourceLang = detectDeEnHeuristic(text);
          const created: Segment = {
            segmentId,
            itemId,
            speakerId,
            t0Ms,
            t1Ms,
            sourceText: text,
            sourceLang,
            rev: 0,
            firstSeenAtMs: now,
            updatedAtMs: now,
            translationsByLang: {},
          };
          return { ...state, segmentsById: { ...state.segmentsById, [segmentId]: created } };
        }

        const nextSourceLang = prev.sourceLang ?? detectDeEnHeuristic(text);
        const changed =
          prev.sourceText !== text ||
          prev.speakerId !== speakerId ||
          prev.itemId !== itemId ||
          prev.t0Ms !== t0Ms ||
          prev.t1Ms !== t1Ms ||
          prev.sourceLang !== nextSourceLang;
        if (!changed) return state;

        const updated: Segment = {
          ...prev,
          itemId,
          speakerId,
          t0Ms,
          t1Ms,
          sourceText: text,
          sourceLang: nextSourceLang,
          rev: prev.rev + 1,
          updatedAtMs: now,
        };
        return { ...state, segmentsById: { ...state.segmentsById, [segmentId]: updated } };
      }

      if (t === "conversation.item.input_audio_transcription.delta") {
        const itemId = typeof e.item_id === "string" ? e.item_id : undefined;
        const contentIndex = Number.isFinite(Number(e.content_index)) ? Number(e.content_index) : 0;
        const delta = typeof e.delta === "string" ? e.delta : "";
        if (!itemId || delta.length === 0) return state;
        const segmentId = `item_${itemId}:c${contentIndex}`;
        const now = Date.now();
        const prev = state.segmentsById[segmentId];
        if (!prev) {
          const created: Segment = {
            segmentId,
            itemId,
            speakerId: undefined,
            t0Ms: state.itemStartMsById[itemId],
            t1Ms: state.itemEndMsById[itemId],
            sourceText: delta,
            sourceLang: detectDeEnHeuristic(delta),
            rev: 0,
            firstSeenAtMs: now,
            updatedAtMs: now,
            translationsByLang: {},
          };
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime/store.ts:delta:create',message:'delta segment created',data:{segmentId,sourceLen:created.sourceText.length,sourceLang:created.sourceLang ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H'})}).catch(()=>{});
          // #endregion
          return { ...state, segmentsById: { ...state.segmentsById, [segmentId]: created } };
        }

        const nextText = prev.sourceText + delta;
        if (nextText === prev.sourceText) return state;
        const nextLang = prev.sourceLang ?? detectDeEnHeuristic(nextText);
        const updated: Segment = {
          ...prev,
          sourceText: nextText,
          sourceLang: nextLang,
          t1Ms: state.itemEndMsById[itemId] ?? prev.t1Ms,
          rev: prev.rev + 1,
          updatedAtMs: now,
        };
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime/store.ts:delta:update',message:'delta segment updated',data:{segmentId,sourceLen:updated.sourceText.length,sourceLang:updated.sourceLang ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        return { ...state, segmentsById: { ...state.segmentsById, [segmentId]: updated } };
      }

      if (t === "conversation.item.input_audio_transcription.completed") {
        const itemId = typeof e.item_id === "string" ? e.item_id : undefined;
        const contentIndex = Number.isFinite(Number(e.content_index)) ? Number(e.content_index) : 0;
        const transcript = typeof e.transcript === "string" ? e.transcript : "";
        if (!itemId || transcript.length === 0) return state;
        const segmentId = `item_${itemId}:c${contentIndex}`;
        const now = Date.now();
        const prev = state.segmentsById[segmentId];
        if (!prev) {
          const created: Segment = {
            segmentId,
            itemId,
            speakerId: undefined,
            t0Ms: state.itemStartMsById[itemId],
            t1Ms: state.itemEndMsById[itemId],
            sourceText: transcript,
            sourceLang: detectDeEnHeuristic(transcript),
            rev: 0,
            firstSeenAtMs: now,
            updatedAtMs: now,
            translationsByLang: {},
          };
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime/store.ts:completed:create',message:'completed segment created',data:{segmentId,sourceLen:created.sourceText.length,sourceLang:created.sourceLang ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H'})}).catch(()=>{});
          // #endregion
          return { ...state, segmentsById: { ...state.segmentsById, [segmentId]: created } };
        }

        if (prev.sourceText === transcript) return state;
        const nextLang = prev.sourceLang ?? detectDeEnHeuristic(transcript);
        const updated: Segment = {
          ...prev,
          sourceText: transcript,
          sourceLang: nextLang,
          t1Ms: state.itemEndMsById[itemId] ?? prev.t1Ms,
          rev: prev.rev + 1,
          updatedAtMs: now,
        };
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime/store.ts:completed:update',message:'completed segment updated',data:{segmentId,sourceLen:updated.sourceText.length,sourceLang:updated.sourceLang ?? null},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H'})}).catch(()=>{});
        // #endregion
        return { ...state, segmentsById: { ...state.segmentsById, [segmentId]: updated } };
      }

      return state;
    }
  }
}

export type Block = {
  blockId: string;
  speakerId?: string;
  segmentIds: string[];
  t0Ms?: number;
  t1Ms?: number;
  sourceLang?: Lang;
};

export function selectBlocks(state: TranscriptState, args?: { pauseGapMs?: number }): Block[] {
  const pauseGapMs = args?.pauseGapMs ?? 900;

  const segs = Object.values(state.segmentsById);
  segs.sort((a, b) => {
    const ta = a.t0Ms ?? a.firstSeenAtMs;
    const tb = b.t0Ms ?? b.firstSeenAtMs;
    return ta - tb;
  });

  const blocks: Block[] = [];
  let cur: Block | null = null;
  let curLastT1: number | undefined = undefined;

  for (const s of segs) {
    const speaker = s.speakerId;
    const t0 = s.t0Ms;
    const t1 = s.t1Ms;

    const speakerChanged = cur && cur.speakerId && speaker && cur.speakerId !== speaker;
    const gapMs =
      cur && typeof curLastT1 === "number" && typeof t0 === "number" ? t0 - curLastT1 : 0;
    const gapSplit = cur && typeof gapMs === "number" && gapMs >= pauseGapMs;

    if (!cur || speakerChanged || gapSplit) {
      cur = {
        blockId: `${speaker ?? "spk_unknown"}:${s.segmentId}`,
        speakerId: speaker,
        segmentIds: [s.segmentId],
        t0Ms: t0,
        t1Ms: t1,
        sourceLang: s.sourceLang,
      };
      blocks.push(cur);
    } else {
      cur.segmentIds.push(s.segmentId);
      if (cur.t0Ms === undefined) cur.t0Ms = t0;
      if (typeof t1 === "number") cur.t1Ms = t1;
      cur.sourceLang = cur.sourceLang ?? s.sourceLang;
    }

    curLastT1 = typeof t1 === "number" ? t1 : curLastT1;
  }

  return blocks;
}

