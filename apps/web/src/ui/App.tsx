import { useReducer } from "react";

import { TranscriptView } from "./realtime/TranscriptView";
import { makeInitialState, transcriptReducer } from "./realtime/store";
import { useRealtimeWebRtc } from "./realtime/useRealtimeWebRtc";

export function App() {
  const [state, dispatch] = useReducer(transcriptReducer, undefined, makeInitialState);

  const rtc = useRealtimeWebRtc({
    dispatch,
    getSegment: (segmentId) => {
      const s = state.segmentsById[segmentId];
      if (!s) return undefined;
      return { sourceText: s.sourceText, rev: s.rev, sourceLang: s.sourceLang };
    },
    columnLangs: state.columnLangs,
  });

  return (
    <div className="appRoot">
      <div className="shell">
        <div className="header">
          <div>
            <h1 className="title">LiveTranslate</h1>
            <p className="subtitle">Realtime WebRTC STT + translation</p>
          </div>
          <div className="pill">
            <span
              className={`dot ${
                state.status === "open"
                  ? "dotOk"
                  : state.status === "connecting"
                    ? "dotWarn"
                    : state.status === "error"
                      ? "dotBad"
                      : ""
              }`}
            />
            <span>{state.status}</span>
          </div>
        </div>

        <div className="card controls">
          <button
            className="btn btnPrimary"
            onClick={rtc.connect}
            disabled={state.status === "connecting" || state.status === "open"}
          >
            Start
          </button>
          <button
            className="btn btnDanger"
            onClick={rtc.disconnect}
            disabled={state.status !== "open"}
          >
            Stop
          </button>
          <button
            className="btn btnSmall"
            onClick={() => dispatch({ type: "transcript.reset" })}
          >
            Clear
          </button>
          {rtc.lastError ? <span className="pill">{rtc.lastError}</span> : null}
        </div>

        <div className="card main">
          <TranscriptView state={state} />
        </div>
      </div>
    </div>
  );
}

