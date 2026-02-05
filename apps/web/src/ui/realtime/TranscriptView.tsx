import { useEffect, useMemo, useRef, useState } from "react";

import type { Lang } from "@livetranslate/shared";

import type { TranscriptState } from "./store";
import { selectBlocks } from "./store";

function joinTexts(parts: Array<string | undefined>) {
  return parts
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p.length > 0)
    .join(" ");
}

export function TranscriptView({ state }: { state: TranscriptState }) {
  const [lang1, lang2] = state.columnLangs;

  const blocks = useMemo(() => selectBlocks(state), [state]);

  const rows = useMemo(() => {
    return blocks.map((b) => {
      const segs = b.segmentIds.map((id) => state.segmentsById[id]).filter(Boolean);

      const sourceLang: Lang | undefined = b.sourceLang;
      const from = sourceLang;
      const to = from === lang1 ? lang2 : from === lang2 ? lang1 : undefined;

      const sourceText = joinTexts(segs.map((s) => s.sourceText));
      const targetText = to ? joinTexts(segs.map((s) => s.translationsByLang[to])) : "";

      // If language is unknown, default source to left column (stable UX).
      const leftText = sourceLang ? (sourceLang === lang1 ? sourceText : targetText) : sourceText;
      const rightText = sourceLang ? (sourceLang === lang2 ? sourceText : targetText) : targetText;

      return {
        block: b,
        leftText,
        rightText,
        sourceLang,
        sourceText,
        targetText,
        speakerId: b.speakerId,
        segIds: b.segmentIds.join(","),
      };
    });
  }, [blocks, lang1, lang2, state.segmentsById]);

  // #region agent log
  if (rows.length > 0) {
    const sample = rows.slice(0, 3).map((r) => ({
      blockId: r.block.blockId,
      sourceLang: r.sourceLang ?? null,
      leftLen: r.leftText.length,
      rightLen: r.rightText.length,
      segCount: r.block.segmentIds.length,
    }));
    fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'realtime/TranscriptView.tsx:rows',message:'rows computed',data:{rowCount:rows.length,sample},timestamp:Date.now(),sessionId:'debug-session',runId:'pre-fix',hypothesisId:'H'})}).catch(()=>{});
  }
  // #endregion

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const prevLenRef = useRef(0);

  useEffect(() => {
    const thresholdPx = 140;
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
    const prev = prevLenRef.current;
    const next = rows.length;
    prevLenRef.current = next;
    if (next > prev) bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [rows.length]);

  useEffect(() => {
    if (!stickToBottom) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [stickToBottom, rows]);

  return (
    <div className="bubbles">
      <div className="bubblesHeader">
        <div className="bubblesColLabel">{lang1 === "de" ? "Deutsch" : String(lang1).toUpperCase()}</div>
        <div className="bubblesColLabel">{lang2 === "en" ? "English" : String(lang2).toUpperCase()}</div>
      </div>

      {state.lastError ? <div className="errorBox">{state.lastError}</div> : null}

      <div className="bubbleList">
        {rows.length === 0 ? (
          <div className="placeholder">Speak to start…</div>
        ) : (
          rows.map((r) => (
            <div
              key={r.block.blockId}
              className="bubbleRow"
              data-block-id={r.block.blockId}
              data-speaker-id={r.speakerId ?? ""}
              data-segment-ids={r.segIds}
              data-source-lang={r.sourceLang ?? ""}
            >
              <div className="bubbleCell">
                {r.leftText ? <div className="bubble">{r.leftText}</div> : null}
              </div>
              <div className="bubbleCell">
                {r.rightText ? <div className="bubble bubbleAlt">{r.rightText}</div> : null}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

