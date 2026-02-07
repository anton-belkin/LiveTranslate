import { useEffect, useMemo, useReducer, useState } from "react";

import { TranscriptView } from "./liveTranslate/TranscriptView";
import { makeInitialState, transcriptReducer } from "./liveTranslate/store";
import { useLiveTranslateStream } from "./liveTranslate/useLiveTranslateStream";
import { parseUrlConfig, updateUrlParam } from "./liveTranslate/urlConfig";

export function App() {
  const [state, dispatch] = useReducer(transcriptReducer, undefined, makeInitialState);
  const urlConfig = useMemo(() => parseUrlConfig(), []);
  const [showOriginal, setShowOriginal] = useState(urlConfig.showOriginal);
  const [audioSource, setAudioSource] = useState(urlConfig.audioSource);
  const isLean = urlConfig.lean;

  useEffect(() => {
    updateUrlParam("showOriginal", showOriginal ? "1" : "0");
  }, [showOriginal]);

  useEffect(() => {
    updateUrlParam("audioSource", audioSource);
  }, [audioSource]);

  useEffect(() => {
    if (!isLean) return;
    document.body.classList.add("leanBody");
    return () => document.body.classList.remove("leanBody");
  }, [isLean]);

  const stream = useLiveTranslateStream({
    url: state.url,
    dispatch,
    targetLangs: urlConfig.targetLangs,
    staticContext: urlConfig.staticContext,
    audioSource,
  });

  useEffect(() => {
    if (!isLean) return;
    if (state.status === "open" || state.status === "connecting") return;
    stream.start();
  }, [isLean, state.status, stream]);

  return (
    <div className={`appRoot${isLean ? " lean" : ""}`}>
      <div className={`shell${isLean ? " shellLean" : ""}`}>
        {isLean ? null : (
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
        )}

        {isLean ? null : (
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
            <label className="toggle">
              <span>Audio</span>
              <select
                value={audioSource}
                onChange={(ev) => setAudioSource(ev.target.value as "mic" | "tab" | "both")}
              >
                <option value="tab">Tab/System</option>
                <option value="mic">Mic</option>
                <option value="both">Both</option>
              </select>
            </label>
            {state.lastSocketError ? <span className="pill">{state.lastSocketError}</span> : null}
          </div>
        )}

        <TranscriptView
          state={state}
          showOriginal={showOriginal}
          showSummary={urlConfig.showSummary}
          lean={isLean}
        />
      </div>
    </div>
  );
}

