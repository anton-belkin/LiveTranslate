import { useEffect, useMemo, useRef, useState } from "react";

import type { TranscriptState } from "./store";
import type { Turn } from "./store";
import { TurnBlock } from "./TurnBlock";

export function TranscriptView({ state }: { state: TranscriptState }) {
  const turns = useMemo(
    () =>
      state.turnOrder
        .map((id) => state.turnsById[id])
        .filter((t): t is Turn => Boolean(t)),
    [state.turnOrder, state.turnsById],
  );

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const prevCountRef = useRef(0);
  const [stickToBottom, setStickToBottom] = useState(true);

  const lastTurnId = state.turnOrder.length > 0 ? state.turnOrder[state.turnOrder.length - 1] : undefined;
  const lastTurn = lastTurnId ? state.turnsById[lastTurnId] : undefined;

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
    const next = turns.length;
    prevCountRef.current = next;
    if (next > prev) {
      bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
    }
  }, [turns.length]);

  useEffect(() => {
    // Keep new partial updates visible if the user is already near the bottom.
    if (!stickToBottom) return;
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [stickToBottom, lastTurn]);

  return (
    <div className="card main">
      <div className="transcriptHeader">
        <div className="colHeader">
          <strong>Deutsch</strong>
          <span>Original</span>
        </div>
        <div className="colHeader">
          <strong>English</strong>
          <span>Translation (stub)</span>
        </div>
      </div>

      {state.lastServerError ? (
        <div className="errorBox">
          <strong>Server error</strong>
          {"\n"}
          {state.lastServerError}
        </div>
      ) : null}

      <div className="turnList">
        {turns.length === 0 ? (
          <div className="cell placeholder">
            Waiting for `turn.*` / `stt.*` events. You can connect to the WS server
            or use the dev mock generator.
          </div>
        ) : (
          turns.map((turn) => <TurnBlock key={turn.turnId} turn={turn} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

