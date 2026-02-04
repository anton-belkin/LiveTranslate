import { memo, useMemo } from "react";

import type { Lang } from "@livetranslate/shared";

import type { Turn } from "./store";

function formatSeconds(ms?: number) {
  if (ms === undefined) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

function Segments({ turn, lang }: { turn: Turn; lang: Lang }) {
  const segs = useMemo(() => {
    const out: Array<{
      segmentId: string;
      text: string;
      isFinal: boolean;
    }> = [];

    for (const segmentId of turn.segmentOrder) {
      const seg = turn.segmentsById[segmentId];
      if (!seg) continue;
      if (seg.lang !== lang) continue;
      if (!seg.text) continue;
      out.push({ segmentId: seg.segmentId, text: seg.text, isFinal: seg.isFinal });
    }
    return out;
  }, [turn.segmentOrder, turn.segmentsById, lang]);

  if (segs.length === 0) return null;

  return (
    <div className="segList">
      {segs.map((seg) => {
        const showText = seg.isFinal ? seg.text : seg.text.endsWith("…") ? seg.text : `${seg.text}…`;
        return (
          <div key={seg.segmentId} className={`segLine ${seg.isFinal ? "segFinal" : "segPartial"}`}>
            {showText}
          </div>
        );
      })}
    </div>
  );
}

export const TurnBlock = memo(function TurnBlock({ turn }: { turn: Turn }) {
  const hasDe = useMemo(() => {
    for (const segmentId of turn.segmentOrder) {
      const seg = turn.segmentsById[segmentId];
      if (seg?.lang === "de" && seg.text) return true;
    }
    return false;
  }, [turn.segmentOrder, turn.segmentsById]);

  const hasEn = useMemo(() => {
    for (const segmentId of turn.segmentOrder) {
      const seg = turn.segmentsById[segmentId];
      if (seg?.lang === "en" && seg.text) return true;
    }
    return false;
  }, [turn.segmentOrder, turn.segmentsById]);

  const dePlaceholder = !hasDe && hasEn;
  const enPlaceholder = !hasEn && hasDe;

  return (
    <div className="turn">
      <div className="turnMeta">
        <div className="mono">
          <span>turnId </span>
          <strong>{turn.turnId}</strong>
          <span style={{ opacity: 0.65 }}> · </span>
          <span>start {formatSeconds(turn.startMs)}</span>
          <span style={{ opacity: 0.65 }}> · </span>
          <span>end {formatSeconds(turn.endMs)}</span>
        </div>
        <div>
          {turn.isFinal ? (
            <span className="pill">
              <span className="dot dotOk" /> Final
            </span>
          ) : (
            <span className="pill">
              <span className="dot dotWarn" /> Live
            </span>
          )}
        </div>
      </div>

      <div className="turnGrid">
        <div className="cell original">
          {dePlaceholder ? (
            <span className="placeholder">Translation pending…</span>
          ) : (
            <Segments turn={turn} lang="de" />
          )}
          {!dePlaceholder && !hasDe ? (
            <span className="placeholder">—</span>
          ) : null}
        </div>

        <div className="cell translation">
          {enPlaceholder ? (
            <span className="placeholder">Translation pending…</span>
          ) : (
            <Segments turn={turn} lang="en" />
          )}
          {!enPlaceholder && !hasEn ? (
            <span className="placeholder">—</span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

