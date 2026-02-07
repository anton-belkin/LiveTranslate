import { useEffect, useMemo, useRef, useState } from "react";

import type { Lang } from "@livetranslate/shared";

import type { TranscriptState, Turn } from "./store";

const PAUSE_GAP_MS = 900;
const DEBUG_LOGS = import.meta.env.VITE_DEBUG_LOGS === "true";
const LEAN_MAX_ROWS = 200;

function debugLog(payload: Record<string, unknown>) {
  if (!DEBUG_LOGS) return;
  fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

type BubbleGroup = {
  groupId: string;
  speakerId?: string;
  lang?: Lang;
  turns: Turn[];
  startMs?: number;
  endMs?: number;
};

const DEFAULT_TARGET_LANGS: Lang[] = ["en", "de", "ru"];

const LANG_LABELS: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  ru: "Russian",
};

function formatLangLabel(lang: Lang) {
  return LANG_LABELS[lang] ?? lang.toUpperCase();
}

function getTurnLang(turn: Turn): Lang | undefined {
  if (turn.lang) return turn.lang;
  for (const translation of Object.values(turn.translationsByLang)) {
    if (translation?.from) return translation.from;
  }
  for (const segmentId of turn.segmentOrder) {
    const seg = turn.segmentsById[segmentId];
    if (seg?.lang) return seg.lang;
  }
  return undefined;
}

function getTurnSourceLang(turn: Turn): Lang | undefined {
  for (const translation of Object.values(turn.translationsByLang)) {
    if (translation?.sourceLang) return translation.sourceLang;
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

export function TranscriptView({
  state,
  showOriginal,
  showSummary,
  lean,
}: {
  state: TranscriptState;
  showOriginal: boolean;
  showSummary: boolean;
  lean: boolean;
}) {
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
        cur && typeof curLastEnd === "number" && typeof startMs === "number"
          ? startMs - curLastEnd
          : 0;
      const speakerChanged =
        cur && cur.speakerId && speakerId && cur.speakerId !== speakerId;
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

  const targetLangs =
    state.targetLangs && state.targetLangs.length > 0
      ? state.targetLangs
      : DEFAULT_TARGET_LANGS;

  const rows = useMemo(() => {
    return groups.map((group) => {
      const originalParts: string[] = [];
      let originalHasText = false;
      let originalIsFinal = true;
      let originalIsPartial = false;
      let sourceLang: Lang | undefined = undefined;

      const translations = new Map<
        Lang,
        {
          parts: string[];
          hasText: boolean;
          isFinal: boolean;
          isPartial: boolean;
          missing: boolean;
        }
      >();

      for (const lang of targetLangs) {
        translations.set(lang, {
          parts: [],
          hasText: false,
          isFinal: true,
          isPartial: false,
          missing: false,
        });
      }

      for (const turn of group.turns) {
        const turnLang = getTurnLang(turn);
        const turnSourceLang = getTurnSourceLang(turn);
        if (turnSourceLang) sourceLang = turnSourceLang;
        const original = collectSegmentText(turn, turnLang);
        if (original.text) {
          originalParts.push(original.text);
          originalHasText = true;
          if (!original.isFinal) originalIsFinal = false;
          if (original.isPartial) originalIsPartial = true;
        }

        for (const lang of targetLangs) {
          const translation = turn.translationsByLang[lang];
          const bucket = translations.get(lang);
          if (!bucket) continue;
          const translationText = translation?.text?.trim() ?? "";
          if (translationText) {
            bucket.parts.push(translationText);
            bucket.hasText = true;
            if (!translation.isFinal) bucket.isFinal = false;
            if (!translation.isFinal) bucket.isPartial = true;
          } else if (original.text) {
            bucket.missing = true;
          }
        }
      }

      const originalText = originalParts.join(originalParts.length > 1 ? "\n" : " ");
      const originalPartial = originalHasText && (originalIsPartial || !originalIsFinal);

      return {
        group,
        originalText,
        originalPartial,
        translations,
        sourceLang,
      };
    });
  }, [groups, targetLangs]);

  const visibleRows = useMemo(() => {
    if (!lean) return rows;
    if (rows.length <= LEAN_MAX_ROWS) return rows;
    return rows.slice(rows.length - LEAN_MAX_ROWS);
  }, [lean, rows]);

  // #region agent log
  useEffect(() => {
    const latest = rows[rows.length - 1];
    const firstTranslation = latest?.translations.values().next().value;
    debugLog({
      location: "TranscriptView.tsx:rows",
      message: "rows recomputed",
      data: {
        rowsCount: rows.length,
        originalLen: latest?.originalText?.length ?? 0,
        translationLen: firstTranslation?.parts?.join(" ").length ?? 0,
      },
      timestamp: Date.now(),
      sessionId: "debug-session",
      runId: "run1",
      hypothesisId: "H2",
    });
  }, [rows]);
  // #endregion

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);

  const lastGroup = groups.length > 0 ? groups[groups.length - 1] : undefined;
  const columnCount = (showOriginal ? 1 : 0) + targetLangs.length;
  const gridStyle = { gridTemplateColumns: `repeat(${Math.max(columnCount, 1)}, minmax(0, 1fr))` };

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
        {showSummary && !lean ? (
          <div className="summaryPanel">
            <div className="summaryHeader">Summary (EN)</div>
            <div className="summaryBody">{state.summary ?? "—"}</div>
          </div>
        ) : null}

        {lean ? null : (
          <div className="bubblesHeader" style={gridStyle}>
            {showOriginal ? (
              <div className="bubblesColLabel">
                <strong>Original</strong>
              </div>
            ) : null}
            {targetLangs.map((lang) => (
              <div key={lang} className="bubblesColLabel">
                <strong>{formatLangLabel(lang)}</strong>
              </div>
            ))}
          </div>
        )}

        {state.lastServerError && !lean ? (
          <div className="errorBox">
            <strong>Server error</strong>
            {"\n"}
            {state.lastServerError}
          </div>
        ) : null}

        <div className="bubbleList">
          {visibleRows.length === 0 ? null : (
            visibleRows.map((row) => (
              <div
                key={row.group.groupId}
                className="bubbleRow"
                data-speaker-id={row.group.speakerId ?? ""}
                data-turn-count={row.group.turns.length}
                style={gridStyle}
              >
                {showOriginal ? (
                  <div className="bubbleCell">
                    {row.originalText ? (
                      <div className={`bubble ${row.originalPartial ? "segPartial" : "segFinal"}`}>
                        {row.originalText}
                        {row.originalPartial ? <span className="cursor">▍</span> : null}
                      </div>
                    ) : (
                      <span className="placeholder">—</span>
                    )}
                  </div>
                ) : null}
                {targetLangs.map((lang) => {
                  const col = row.translations.get(lang);
                  const text = col?.parts.join(col.parts.length > 1 ? "\n" : " ") ?? "";
                  const isPartial = col?.hasText && (col.isPartial || !col.isFinal);
                  const missing = col?.missing ?? false;
                  const isOriginalLang = Boolean(row.sourceLang && lang === row.sourceLang);
                  return (
                    <div key={`${row.group.groupId}:${lang}`} className="bubbleCell">
                      {text ? (
                        <div
                          className={`bubble ${isOriginalLang ? "bubbleAlt" : ""} ${
                            isPartial ? "segPartial" : "segFinal"
                          }`}
                        >
                          {text}
                          {isPartial ? <span className="cursor">▍</span> : null}
                        </div>
                      ) : missing ? (
                        <span className="placeholder">Translation pending…</span>
                      ) : (
                        <span className="placeholder">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}

