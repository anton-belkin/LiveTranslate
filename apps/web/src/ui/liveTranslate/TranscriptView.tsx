import { useEffect, useMemo, useRef, useState } from "react";

import type { Lang } from "@livetranslate/shared";

import type { TranscriptState, Turn } from "./store";

const PAUSE_GAP_MS = 900;

type BubbleGroup = {
  groupId: string;
  speakerId?: string;
  lang?: Lang;
  turns: Turn[];
  startMs?: number;
  endMs?: number;
};

function getTurnLang(turn: Turn): Lang | undefined {
  if (turn.lang) return turn.lang;
  if (turn.translation?.from) return turn.translation.from;
  for (const segmentId of turn.segmentOrder) {
    const seg = turn.segmentsById[segmentId];
    if (seg?.lang) return seg.lang;
  }
  return undefined;
}

function getTurnStartMs(turn: Turn) {
  if (typeof turn.startMs === "number") return turn.startMs;
  for (const segmentId of turn.segmentOrder) {
    const seg = turn.segmentsById[segmentId];
    if (seg && typeof seg.startMs === "number") return seg.startMs;
  }
  return undefined;
}

function getTurnEndMs(turn: Turn) {
  if (typeof turn.endMs === "number") return turn.endMs;
  let latest: number | undefined = undefined;
  for (const segmentId of turn.segmentOrder) {
    const seg = turn.segmentsById[segmentId];
    const t = typeof seg?.endMs === "number" ? seg.endMs : seg?.startMs;
    if (typeof t === "number") latest = latest === undefined ? t : Math.max(latest, t);
  }
  return latest;
}

function collectSegmentText(turn: Turn, lang?: Lang) {
  const parts: string[] = [];
  let anyFinal = false;
  let anyPartial = false;

  for (const segmentId of turn.segmentOrder) {
    const seg = turn.segmentsById[segmentId];
    if (!seg) continue;
    if (lang && seg.lang && seg.lang !== lang) continue;
    const txt = seg.text?.trim();
    if (!txt) continue;
    if (!seg.isFinal && txt.length < 3) continue;
    parts.push(txt);
    if (seg.isFinal) anyFinal = true;
    else anyPartial = true;
  }

  const text = parts.join(parts.length > 1 ? "\n" : " ");
  const isFinal = anyFinal && !anyPartial;
  const isPartial = anyPartial;
  return { text, isFinal, isPartial };
}

export function TranscriptView({ state }: { state: TranscriptState }) {
  const turns = useMemo(
    () =>
      state.turnOrder
        .map((id) => state.turnsById[id])
        .filter((t): t is Turn => Boolean(t)),
    [state.turnOrder, state.turnsById],
  );

  const groups = useMemo(() => {
    const acc: BubbleGroup[] = [];
    let cur: BubbleGroup | null = null;
    let curLastEnd: number | undefined = undefined;

    for (const turn of turns) {
      const speakerId = turn.speakerId;
      const lang = getTurnLang(turn);
      const startMs = getTurnStartMs(turn);
      const endMs = getTurnEndMs(turn);
      const gapMs =
        cur && typeof curLastEnd === "number" && typeof startMs === "number" ? startMs - curLastEnd : 0;
      const speakerChanged = cur && cur.speakerId && speakerId && cur.speakerId !== speakerId;
      const langChanged = cur && cur.lang && lang && cur.lang !== lang;
      const gapSplit = cur && typeof gapMs === "number" && gapMs >= PAUSE_GAP_MS;

      if (!cur || speakerChanged || langChanged || gapSplit) {
        cur = {
          groupId: `${speakerId ?? "spk_unknown"}:${turn.turnId}`,
          speakerId,
          lang,
          turns: [turn],
          startMs,
          endMs,
        };
        acc.push(cur);
      } else {
        cur.turns.push(turn);
        if (cur.startMs === undefined) cur.startMs = startMs;
        if (typeof endMs === "number") cur.endMs = endMs;
        if (!cur.lang && lang) cur.lang = lang;
      }

      if (typeof endMs === "number") curLastEnd = endMs;
    }

    return acc;
  }, [turns]);

  const rows = useMemo(() => {
    return groups.map((group) => {
      const sourceLang = group.lang ?? "de";
      const originalParts: string[] = [];
      const translationParts: string[] = [];
      let originalHasText = false;
      let originalIsFinal = true;
      let originalIsPartial = false;
      let translationHasText = false;
      let translationIsFinal = true;
      let translationMissing = false;

      for (const turn of group.turns) {
        const turnLang = getTurnLang(turn) ?? sourceLang;
        const original = collectSegmentText(turn, turnLang);
        if (original.text) {
          originalParts.push(original.text);
          originalHasText = true;
          if (!original.isFinal) originalIsFinal = false;
          if (original.isPartial) originalIsPartial = true;
        }

        const translationText = turn.translation?.text?.trim() ?? "";
        if (translationText) {
          translationParts.push(translationText);
          translationHasText = true;
          if (!turn.translation?.isFinal) translationIsFinal = false;
        } else if (original.text) {
          translationMissing = true;
        }
      }

      if (translationMissing) translationIsFinal = false;

      const originalText = originalParts.join(originalParts.length > 1 ? "\n" : " ");
      const translationText = translationParts.join(translationParts.length > 1 ? "\n" : " ");

      const originalPartial = originalHasText && (originalIsPartial || !originalIsFinal);
      const translationPartial = translationHasText && !translationIsFinal;

      const leftIsTranslation = sourceLang === "en";
      const rightIsTranslation = !leftIsTranslation;

      const leftText = leftIsTranslation ? translationText : originalText;
      const rightText = leftIsTranslation ? originalText : translationText;

      const leftPartial = leftIsTranslation ? translationPartial : originalPartial;
      const rightPartial = leftIsTranslation ? originalPartial : translationPartial;

      return {
        group,
        leftText,
        rightText,
        leftPartial,
        rightPartial,
        leftIsTranslation,
        rightIsTranslation,
      };
    });
  }, [groups]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);

  const lastGroup = groups.length > 0 ? groups[groups.length - 1] : undefined;

  useEffect(() => {
    const thresholdPx = 120;

    const recompute = () => {
      const atBottom =
        window.innerHeight + window.scrollY >= document.body.scrollHeight - thresholdPx;
      setStickToBottom(atBottom);
    };

    recompute();
    window.addEventListener("scroll", recompute, { passive: true });
    return () => window.removeEventListener("scroll", recompute);
  }, []);

  useEffect(() => {
    const prev = prevCountRef.current;
    const next = rows.length;
    prevCountRef.current = next;
    if (next > prev) {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [rows.length]);

  useEffect(() => {
    // Keep new partial updates visible if the user is already near the bottom.
    if (!stickToBottom) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [stickToBottom, lastGroup]);

  return (
    <div className="card main">
      <div className="bubbles">
        <div className="bubblesHeader">
          <div className="bubblesColLabel">
            <strong>Deutsch</strong>
            <span>Original</span>
          </div>
          <div className="bubblesColLabel">
            <strong>English</strong>
            <span>Translation</span>
          </div>
        </div>

        {state.lastServerError ? (
          <div className="errorBox">
            <strong>Server error</strong>
            {"\n"}
            {state.lastServerError}
          </div>
        ) : null}

        <div className="bubbleList">
          {rows.length === 0 ? (
            <div className="placeholder">
              Waiting for `turn.*` / `stt.*` events. You can connect to the WS server or use the dev
              mock generator.
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.group.groupId}
                className="bubbleRow"
                data-speaker-id={row.group.speakerId ?? ""}
                data-turn-count={row.group.turns.length}
              >
                <div className="bubbleCell">
                  {row.leftText ? (
                    <div className={`bubble ${row.leftPartial ? "segPartial" : "segFinal"}`}>
                      {row.leftText}
                      {row.leftPartial ? <span className="cursor">▍</span> : null}
                    </div>
                  ) : row.leftIsTranslation ? (
                    <span className="placeholder">Translation pending…</span>
                  ) : (
                    <span className="placeholder">—</span>
                  )}
                </div>
                <div className="bubbleCell">
                  {row.rightText ? (
                    <div className={`bubble bubbleAlt ${row.rightPartial ? "segPartial" : "segFinal"}`}>
                      {row.rightText}
                      {row.rightPartial ? <span className="cursor">▍</span> : null}
                    </div>
                  ) : row.rightIsTranslation ? (
                    <span className="placeholder">Translation pending…</span>
                  ) : (
                    <span className="placeholder">—</span>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

