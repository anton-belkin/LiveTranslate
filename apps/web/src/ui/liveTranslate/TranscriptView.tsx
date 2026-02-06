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

type TranslationRowState = {
  parts: string[];
  hasText: boolean;
  isFinal: boolean;
  isPartial: boolean;
  missing: boolean;
};

const TRANSLATION_COLUMNS: Array<{ lang: Lang; label: string }> = [
  { lang: "de", label: "Deutsch" },
  { lang: "en", label: "English" },
  { lang: "ru", label: "Russian" },
];

function getTurnLang(turn: Turn): Lang | undefined {
  if (turn.lang) return turn.lang;
  for (const segmentId of turn.segmentOrder) {
    const seg = turn.segmentsById[segmentId];
    if (seg?.lang) return seg.lang;
  }
  return undefined;
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

export function TranscriptView({
  state,
  showOriginal,
}: {
  state: TranscriptState;
  showOriginal: boolean;
}) {
  const enableRu =
    typeof window !== "undefined" &&
    ["1", "true", "yes"].includes(
      new URLSearchParams(window.location.search).get("ru")?.toLowerCase() ?? "",
    );
  const translationColumns = useMemo(
    () =>
      enableRu
        ? TRANSLATION_COLUMNS
        : TRANSLATION_COLUMNS.filter((col) => col.lang !== "ru"),
    [enableRu],
  );
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

  const rows = useMemo(() => {
    return groups.map((group) => {
      const originalParts: string[] = [];
      let originalHasText = false;
      let originalIsFinal = true;
      let originalIsPartial = false;

      const translations: Record<Lang, TranslationRowState> = {
        de: { parts: [], hasText: false, isFinal: true, isPartial: false, missing: false },
        en: { parts: [], hasText: false, isFinal: true, isPartial: false, missing: false },
        ru: { parts: [], hasText: false, isFinal: true, isPartial: false, missing: false },
      };

      for (const turn of group.turns) {
        const original = collectSegmentText(turn);
        const turnLang = getTurnLang(turn);
        if (original.text) {
          originalParts.push(original.text);
          originalHasText = true;
          if (!original.isFinal) originalIsFinal = false;
          if (original.isPartial) originalIsPartial = true;
        }

        for (const { lang } of translationColumns) {
          const translation = turn.translationsByLang?.[lang];
          const translatedText = translation?.text?.trim();
          if (translation && translatedText) {
            translations[lang].parts.push(translatedText);
            translations[lang].hasText = true;
            if (!translation.isFinal) translations[lang].isFinal = false;
            if (!translation.isFinal) translations[lang].isPartial = true;
            continue;
          }

          if (turnLang === lang) {
            const source = collectSegmentText(turn, lang);
            if (source.text) {
              translations[lang].parts.push(source.text);
              translations[lang].hasText = true;
              if (!source.isFinal) translations[lang].isFinal = false;
              if (source.isPartial) translations[lang].isPartial = true;
              continue;
            }
          }

          if (original.text) {
            translations[lang].missing = true;
          }
        }
      }

      for (const { lang } of translationColumns) {
        if (translations[lang].missing) translations[lang].isFinal = false;
      }

      const originalText = originalParts.join(originalParts.length > 1 ? "\n" : " ");
      const originalPartial = originalHasText && (originalIsPartial || !originalIsFinal);

      const translationsByLang = translationColumns.reduce(
        (acc, { lang }) => {
          const text = translations[lang].parts.join(
            translations[lang].parts.length > 1 ? "\n" : " ",
          );
          const partial = translations[lang].hasText
            ? translations[lang].isPartial || !translations[lang].isFinal
            : false;
          acc[lang] = {
            text,
            partial,
            missing: translations[lang].missing,
          };
          return acc;
        },
        {} as Record<Lang, { text: string; partial: boolean; missing: boolean }>,
      );

      return {
        group,
        originalText,
        originalPartial,
        translationsByLang,
      };
    });
  }, [groups, translationColumns]);

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
        <div className={`bubblesHeader ${showOriginal ? "cols-4" : "cols-3"}`}>
          {showOriginal ? (
            <div className="bubblesColLabel">
              <strong>Original</strong>
              <span>Text</span>
            </div>
          ) : null}
          {translationColumns.map((col) => (
            <div key={col.lang} className="bubblesColLabel">
              <strong>{col.label}</strong>
              <span>Text</span>
            </div>
          ))}
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
              Waiting for `turn.*` / `stt.*` events. You can connect to the WS server or use
              the dev mock generator.
            </div>
          ) : (
            rows.map((row) => (
              <div
                key={row.group.groupId}
                className={`bubbleRow ${showOriginal ? "cols-4" : "cols-3"}`}
                data-speaker-id={row.group.speakerId ?? ""}
                data-turn-count={row.group.turns.length}
              >
                {showOriginal ? (
                  <div className="bubbleCell">
                    {row.originalText ? (
                      <div
                        className={`bubble ${
                          row.originalPartial ? "segPartial" : "segFinal"
                        }`}
                      >
                        {row.originalText}
                        {row.originalPartial ? <span className="cursor">▍</span> : null}
                        <div className="bubbleMeta mono">
                          {row.group.lang ? row.group.lang.toUpperCase() : "?"} ·{" "}
                          {row.group.turns[0]?.turnId ?? row.group.groupId}
                          {row.originalPartial ? " P" : ""}
                        </div>
                      </div>
                    ) : (
                      <span className="placeholder">—</span>
                    )}
                  </div>
                ) : null}
                {translationColumns.map((col) => {
                  const cell = row.translationsByLang[col.lang];
                  return (
                    <div key={`${row.group.groupId}-${col.lang}`} className="bubbleCell">
                      {cell.text ? (
                        <div
                          className={`bubble bubbleAlt ${
                            cell.partial ? "segPartial" : "segFinal"
                          }`}
                        >
                          {cell.text}
                          {cell.partial ? <span className="cursor">▍</span> : null}
                        </div>
                      ) : cell.missing ? (
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

