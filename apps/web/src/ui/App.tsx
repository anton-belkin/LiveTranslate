import { useEffect, useMemo, useReducer, useState } from "react";

import { TranscriptView } from "./liveTranslate/TranscriptView";
import { makeInitialState, transcriptReducer } from "./liveTranslate/store";
import { useLiveTranslateStream } from "./liveTranslate/useLiveTranslateStream";
import { parseUrlConfig, updateUrlParam } from "./liveTranslate/urlConfig";

export function App() {
  const [state, dispatch] = useReducer(transcriptReducer, undefined, makeInitialState);
  const urlConfig = useMemo(() => parseUrlConfig(), []);
  const [showOriginal, setShowOriginal] = useState(urlConfig.showOriginal);

  useEffect(() => {
    updateUrlParam("showOriginal", showOriginal ? "1" : "0");
  }, [showOriginal]);

  const stream = useLiveTranslateStream({
    url: state.url,
    dispatch,
    targetLangs: urlConfig.targetLangs,
    staticContext: urlConfig.staticContext,
  });

  return (
    <div className="appRoot">
      <div className="shell">
        <div className="header">
          <div>
            <h1 className="title">LiveTranslate</h1>
            <p className="subtitle">Live WS mic streaming + translation</p>
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
            onClick={stream.start}
            disabled={state.status === "connecting" || state.status === "open"}
          >
            Start
          </button>
          <button
            className="btn btnDanger"
            onClick={stream.stop}
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
          <label className="toggle">
            <input
              type="checkbox"
              checked={showOriginal}
              onChange={(ev) => setShowOriginal(ev.target.checked)}
            />
            <span>Originals</span>
          </label>
          {state.lastSocketError ? <span className="pill">{state.lastSocketError}</span> : null}
        </div>

        <TranscriptView
          state={state}
          showOriginal={showOriginal}
          showSummary={urlConfig.showSummary}
        />
      </div>
    </div>
  );
}

