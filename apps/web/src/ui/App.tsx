import { useEffect, useMemo, useReducer, useState } from "react";

import { TranscriptView } from "./liveTranslate/TranscriptView";
import { makeInitialState, transcriptReducer } from "./liveTranslate/store";
import { useLiveTranslateStream } from "./liveTranslate/useLiveTranslateStream";
import { parseUrlConfig, updateUrlParam } from "./liveTranslate/urlConfig";

export function App() {
  const [state, dispatch] = useReducer(transcriptReducer, undefined, makeInitialState);
  const urlConfig = useMemo(() => parseUrlConfig(), []);
  const [showOriginal, setShowOriginal] = useState(urlConfig.showOriginal);
  const [showSummary, setShowSummary] = useState(urlConfig.showSummary);
  const [staticContext, setStaticContext] = useState(urlConfig.staticContext ?? "");
  const [specialWordsText, setSpecialWordsText] = useState(urlConfig.specialWords ?? "");
  const [specialWordsBoost, setSpecialWordsBoost] = useState(
    urlConfig.specialWordsBoost ?? 1,
  );
  const [showContextPopover, setShowContextPopover] = useState(false);
  const [audioSource, setAudioSource] = useState(urlConfig.audioSource);
  const isLean = urlConfig.lean;

  useEffect(() => {
    updateUrlParam("showOriginal", showOriginal ? "1" : "0");
  }, [showOriginal]);

  useEffect(() => {
    updateUrlParam("showSummary", showSummary ? "1" : "0");
  }, [showSummary]);

  useEffect(() => {
    updateUrlParam("staticContext", staticContext.trim());
  }, [staticContext]);

  useEffect(() => {
    updateUrlParam("specialWords", specialWordsText.replace(/\r\n/g, "\n").trim());
  }, [specialWordsText]);

  useEffect(() => {
    updateUrlParam("specialWordsBoost", String(specialWordsBoost));
  }, [specialWordsBoost]);

  useEffect(() => {
    updateUrlParam("audioSource", audioSource);
  }, [audioSource]);

  useEffect(() => {
    if (!isLean) return;
    document.body.classList.add("leanBody");
    return () => document.body.classList.remove("leanBody");
  }, [isLean]);

  const specialWords = useMemo(
    () =>
      specialWordsText
        .split(/\r?\n/g)
        .map((word) => word.trim())
        .filter((word) => word.length > 0),
    [specialWordsText],
  );

  const stream = useLiveTranslateStream({
    url: state.url,
    dispatch,
    targetLangs: urlConfig.targetLangs,
    staticContext: staticContext.trim() || undefined,
    specialWords,
    specialWordsBoost,
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
              onClick={() => {
                dispatch({ type: "transcript.stopFinalize" });
                void stream.stop();
              }}
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
              <input
                type="checkbox"
                checked={showSummary}
                onChange={(ev) => setShowSummary(ev.target.checked)}
              />
              <span>Summary</span>
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
            <div className="popover">
              <button
                className="btn btnSmall"
                onClick={() => setShowContextPopover((prev) => !prev)}
              >
                Context
              </button>
              {showContextPopover ? (
                <div className="popoverPanel">
                  <label className="fieldLabel">
                    <span>Special words (one per line)</span>
                    <textarea
                      className="input textarea"
                      rows={4}
                      value={specialWordsText}
                      onChange={(ev) => setSpecialWordsText(ev.target.value)}
                      placeholder={`e.g.\nKubernetes\nAnya\nX AE A-12`}
                    />
                  </label>
                  <label className="fieldLabel">
                    <span>Special words boost (1-5)</span>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      max={5}
                      value={specialWordsBoost}
                      onChange={(ev) => {
                        const next = Number(ev.target.value);
                        if (!Number.isFinite(next)) return;
                        const clamped = Math.min(5, Math.max(1, Math.round(next)));
                        setSpecialWordsBoost(clamped);
                      }}
                    />
                  </label>
                  <label className="fieldLabel">
                    <span>Static meeting context</span>
                    <textarea
                      className="input textarea"
                      rows={4}
                      value={staticContext}
                      onChange={(ev) => setStaticContext(ev.target.value)}
                      placeholder="Short brief for better summaries/translations"
                    />
                  </label>
                </div>
              ) : null}
            </div>
            {state.lastSocketError ? <span className="pill">{state.lastSocketError}</span> : null}
          </div>
        )}

        <TranscriptView
          state={state}
          showOriginal={showOriginal}
          showSummary={showSummary}
          lean={isLean}
        />
      </div>
    </div>
  );
}

