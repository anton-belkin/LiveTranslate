import { useCallback, useEffect, useMemo, useRef, useReducer, useState } from "react";

import { safeParseServerMessage, type ServerToClientMessage } from "@livetranslate/shared";

import { startMicStreamer, type MicStreamerHandle, type Pcm16Frame } from "../audio/micStreamer";
import { base64FromArrayBuffer } from "../lib/base64";
import { WsClient, type WsClientState } from "../ws/WsClient";
import { TranscriptView } from "./liveTranslate/TranscriptView";
import { makeInitialState, transcriptReducer, type ConnectionStatus } from "./liveTranslate/store";

function statusDotClass(status: ConnectionStatus) {
  switch (status) {
    case "open":
      return "dot dotOk";
    case "connecting":
      return "dot dotWarn";
    case "error":
      return "dot dotBad";
    case "idle":
    case "closed":
      return "dot";
  }
}

function statusText(status: ConnectionStatus) {
  if (status === "open") return "Connected";
  if (status === "connecting") return "Connecting";
  if (status === "error") return "Error";
  if (status === "closed") return "Closed";
  return "Idle";
}

export function App() {
  const [state, dispatch] = useReducer(transcriptReducer, undefined, makeInitialState);

  const wsRef = useRef<WsClient | null>(null);
  const micRef = useRef<MicStreamerHandle | null>(null);
  const serverSessionIdRef = useRef<string | null>(null);
  const framesSentRef = useRef(0);
  const uiTimerRef = useRef<number | null>(null);

  type DevLatencyMetrics = {
    startMicClickAtMs: number | null;
    firstSttPartialAtMs: number | null;
    lastClientFrameSentAtMs: number | null;
    sttPartialCount: number;
    lastSttPartialAtMs: number | null;
    lastAudioAgeAtSttPartialMs: number | null;
  };

  const devMetricsEnabled = import.meta.env.DEV;

  const metricsRef = useRef<DevLatencyMetrics>({
    startMicClickAtMs: null,
    firstSttPartialAtMs: null,
    lastClientFrameSentAtMs: null,
    sttPartialCount: 0,
    lastSttPartialAtMs: null,
    lastAudioAgeAtSttPartialMs: null,
  });

  const [devMetrics, setDevMetrics] = useState(() => ({
    nowMs: Date.now(),
    ...metricsRef.current,
  }));

  const snapshotDevMetrics = useCallback(() => {
    setDevMetrics({ nowMs: Date.now(), ...metricsRef.current });
  }, []);

  const resetDevMetrics = useCallback(() => {
    metricsRef.current = {
      startMicClickAtMs: null,
      firstSttPartialAtMs: null,
      lastClientFrameSentAtMs: null,
      sttPartialCount: 0,
      lastSttPartialAtMs: null,
      lastAudioAgeAtSttPartialMs: null,
    };
    snapshotDevMetrics();
  }, [snapshotDevMetrics]);

  const [streaming, setStreaming] = useState(false);
  const [wsState, setWsState] = useState<WsClientState>("idle");
  const [status, setStatus] = useState<string>("Idle");
  const [inputSampleRateHz, setInputSampleRateHz] = useState<number | null>(null);
  const [outputSampleRateHz, setOutputSampleRateHz] = useState<number | null>(null);
  const [framesSent, setFramesSent] = useState(0);
  const [lastServerMessage, setLastServerMessage] = useState<string>("");
  const [lastError, setLastError] = useState<string>("");

  useEffect(() => {
    serverSessionIdRef.current = state.sessionId ?? null;
  }, [state.sessionId]);

  const connectWs = useCallback(() => {
    setLastError("");
    setLastServerMessage("");

    wsRef.current?.close();
    wsRef.current = null;

    const ws = new WsClient({
      url: state.url,
      onState: (s) => {
        setWsState(s);
        dispatch({ type: "connection.update", status: s });
      },
      onServerMessage: (msg) => {
        try {
          setLastServerMessage(JSON.stringify(msg));
        } catch {
          setLastServerMessage(String(msg));
        }

        const res = safeParseServerMessage(msg);
        if (res.success) {
          if (devMetricsEnabled) {
            const m = res.data as ServerToClientMessage;
            if (m.type === "stt.partial") {
              const now = Date.now();
              const mr = metricsRef.current;
              mr.sttPartialCount += 1;
              mr.lastSttPartialAtMs = now;
              mr.lastAudioAgeAtSttPartialMs =
                mr.lastClientFrameSentAtMs !== null ? now - mr.lastClientFrameSentAtMs : null;

              if (mr.firstSttPartialAtMs === null && mr.startMicClickAtMs !== null) {
                mr.firstSttPartialAtMs = now;
                console.info("[metrics] first stt.partial", {
                  msFromStart: now - mr.startMicClickAtMs,
                  audioAgeAtPartialMs: mr.lastAudioAgeAtSttPartialMs,
                });
                snapshotDevMetrics();
              }
            }
          }
          dispatch({ type: "server.message", message: res.data });
        }
      },
      autoReconnect: true,
    });

    wsRef.current = ws;
    ws.connect();
  }, [devMetricsEnabled, snapshotDevMetrics, state.url]);

  const disconnectWs = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    dispatch({ type: "connection.update", status: "idle" });
  }, []);

  const stopAudio = useCallback(async () => {
    if (!streaming) return;

    setStatus("Stopping…");
    setStreaming(false);

    if (uiTimerRef.current) {
      window.clearInterval(uiTimerRef.current);
      uiTimerRef.current = null;
    }

    const sid = serverSessionIdRef.current;
    if (sid) wsRef.current?.stop(sid, "user_stop");

    const mic = micRef.current;
    micRef.current = null;
    await mic?.stop();

    if (devMetricsEnabled) snapshotDevMetrics();
    setStatus("Stopped.");
  }, [devMetricsEnabled, snapshotDevMetrics, streaming]);

  const startAudio = useCallback(async () => {
    if (streaming) return;
    setLastError("");
    setStatus("Preparing…");

    if (devMetricsEnabled) {
      resetDevMetrics();
      metricsRef.current.startMicClickAtMs = Date.now();
      snapshotDevMetrics();
    }

    // Ensure we have a WS client (it can reconnect and will drop frames while down).
    if (!wsRef.current) connectWs();

    // Wait briefly for server.ready so we can use the server-issued sessionId.
    const waitForSessionId = async () => {
      const deadline = Date.now() + 2500;
      while (!serverSessionIdRef.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      return serverSessionIdRef.current;
    };

    setStatus("Waiting for server session…");
    const sid = await waitForSessionId();
    if (!sid) {
      setLastError("No sessionId received yet. Click Connect and retry.");
      setStatus("Not connected.");
      return;
    }

    framesSentRef.current = 0;
    setFramesSent(0);

    try {
      setStatus("Requesting microphone permission…");
      const mic = await startMicStreamer({
        targetSampleRateHz: 16000,
        onFrame: (frame: Pcm16Frame) => {
          const currentSid = serverSessionIdRef.current;
          if (!currentSid) return;
          framesSentRef.current += 1;
          const ts = Date.now();
          if (devMetricsEnabled) metricsRef.current.lastClientFrameSentAtMs = ts;
          wsRef.current?.sendJson({
            type: "audio.frame",
            sessionId: currentSid,
            pcm16Base64: base64FromArrayBuffer(frame.pcm16),
            format: "pcm_s16le",
            sampleRateHz: frame.sampleRateHz,
            channels: 1,
            clientTimestampMs: ts,
          });
        },
      });

      micRef.current = mic;
      setInputSampleRateHz(mic.inputSampleRateHz);
      setOutputSampleRateHz(mic.outputSampleRateHz);

      if (uiTimerRef.current) window.clearInterval(uiTimerRef.current);
      uiTimerRef.current = window.setInterval(() => {
        setFramesSent(framesSentRef.current);
        if (devMetricsEnabled) snapshotDevMetrics();
      }, 500);

      setStreaming(true);
      setStatus("Streaming microphone audio (mono PCM16) over WebSocket.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      setStatus("Failed to start.");
    }
  }, [
    connectWs,
    devMetricsEnabled,
    resetDevMetrics,
    snapshotDevMetrics,
    streaming,
  ]);

  const mockTimerRef = useRef<number | null>(null);

  const stopMock = useCallback(() => {
    if (mockTimerRef.current !== null) {
      window.clearInterval(mockTimerRef.current);
      mockTimerRef.current = null;
    }
  }, []);

  const startMock = useCallback(() => {
    stopMock();
    dispatch({ type: "transcript.reset" });

    const now = Date.now();
    const sessionId = `mock_${now}`;

    dispatch({
      type: "server.message",
      message: { type: "server.ready", protocolVersion: 1, sessionId },
    });

    const mkTurn = (ix: number) => `turn_${now}_${ix}`;
    const mkSeg = (ix: number) => `seg_${now}_${ix}`;

    const script = [
      {
        turnId: mkTurn(1),
        lang: "de" as const,
        text:
          "Hallo zusammen, wir starten jetzt. Ich fasse kurz die Agenda für heute zusammen.",
      },
      {
        turnId: mkTurn(2),
        lang: "en" as const,
        text:
          "Sounds good. Could you also include the timeline and the next steps after the meeting?",
      },
      {
        turnId: mkTurn(3),
        lang: "de" as const,
        text:
          "Ja, klar. Erstens Statusupdate, zweitens Risiken, drittens Entscheidungen und To-dos.",
      },
    ];

    let step = 0;
    let wordIndex = 0;
    let activeTurnStart = 0;

    const tick = () => {
      const entry = script[step];
      if (!entry) {
        stopMock();
        return;
      }

      const startMs = activeTurnStart || 0;
      const segmentId = mkSeg(step + 1);

      if (wordIndex === 0) {
        dispatch({
          type: "server.message",
          message: {
            type: "turn.start",
            sessionId,
            turnId: entry.turnId,
            startMs,
          },
        });
      }

      const words = entry.text.split(" ");
      wordIndex = Math.min(wordIndex + 2, words.length);
      const partial = words.slice(0, wordIndex).join(" ");

      dispatch({
        type: "server.message",
        message: {
          type: "stt.partial",
          sessionId,
          turnId: entry.turnId,
          segmentId,
          lang: entry.lang,
          text: partial,
          startMs,
        },
      });

      if (wordIndex >= words.length) {
        const endMs = startMs + 2500 + step * 400;

        dispatch({
          type: "server.message",
          message: {
            type: "stt.final",
            sessionId,
            turnId: entry.turnId,
            segmentId,
            lang: entry.lang,
            text: entry.text,
            startMs,
            endMs,
          },
        });

        dispatch({
          type: "server.message",
          message: {
            type: "turn.final",
            sessionId,
            turnId: entry.turnId,
            startMs,
            endMs,
          },
        });

        step += 1;
        wordIndex = 0;
        activeTurnStart = endMs + 200;
      }
    };

    mockTimerRef.current = window.setInterval(tick, 250);
  }, [stopMock]);

  const connectionPill = useMemo(() => {
    const txt = statusText(state.status);
    return (
      <div className="pill" title={`WsClient: ${wsState}`}>
        <span className={statusDotClass(state.status)} />
        <span>{txt}</span>
      </div>
    );
  }, [state.status, wsState]);

  const fmtMs = useCallback((ms: number | null) => (ms === null ? "—" : `${ms} ms`), []);

  const firstPartialLatencyMs =
    devMetrics.startMicClickAtMs !== null && devMetrics.firstSttPartialAtMs !== null
      ? devMetrics.firstSttPartialAtMs - devMetrics.startMicClickAtMs
      : null;

  const audioAgeNowMs =
    devMetrics.lastClientFrameSentAtMs !== null ? devMetrics.nowMs - devMetrics.lastClientFrameSentAtMs : null;

  return (
    <div className="appRoot">
      <div className="shell">
        <div className="header">
          <div>
            <h2 className="title">LiveTranslate — Milestone 1 (STT-only UI)</h2>
            <p className="subtitle">
              Two-column transcript UI rendering distinct turns from{" "}
              <span className="mono">turn.*</span> +{" "}
              <span className="mono">stt.*</span>. Translation is stubbed.
            </p>
          </div>
          {connectionPill}
        </div>

        <div className="card">
          <div className="controls">
            <label className="fieldLabel">
              WebSocket URL
              <input
                className="input mono"
                value={state.url}
                onChange={(e) => dispatch({ type: "url.set", url: e.target.value })}
                placeholder="ws://localhost:8787"
              />
            </label>

            <button className="btn btnPrimary" onClick={connectWs} type="button">
              Connect
            </button>
            <button className="btn btnDanger" onClick={disconnectWs} type="button">
              Disconnect
            </button>
            <button
              className="btn"
              onClick={() => dispatch({ type: "transcript.reset" })}
              type="button"
            >
              Clear transcript
            </button>

            {import.meta.env.DEV ? (
              <>
                <button className="btn btnSmall" onClick={startMock} type="button">
                  Dev: start mock
                </button>
                <button className="btn btnSmall" onClick={stopMock} type="button">
                  Dev: stop mock
                </button>
              </>
            ) : null}
          </div>

          {lastError ? (
            <div className="errorBox">
              <strong>Client error</strong>
              {"\n"}
              {lastError}
            </div>
          ) : null}

          <details style={{ margin: "0 12px 12px" }}>
            <summary style={{ cursor: "pointer", color: "rgba(229,231,235,0.78)" }}>
              Audio streaming (existing)
            </summary>
            <div style={{ paddingTop: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={startAudio} disabled={streaming} type="button">
                  Start mic
                </button>
                <button className="btn" onClick={stopAudio} disabled={!streaming} type="button">
                  Stop
                </button>
              </div>

              <div style={{ marginTop: 10 }} className="pill">
                <span className="dot" />
                <span className="mono">serverSessionId</span>
                <span>{state.sessionId ?? "—"}</span>
              </div>

              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "180px 1fr", rowGap: 6 }}>
                <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>Input rate</div>
                <div className="mono">{inputSampleRateHz ? `${inputSampleRateHz} Hz` : "—"}</div>
                <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>Output rate</div>
                <div className="mono">{outputSampleRateHz ? `${outputSampleRateHz} Hz` : "—"}</div>
                <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>Frames sent</div>
                <div className="mono">{String(framesSent)}</div>
                <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>Status</div>
                <div style={{ color: "rgba(229,231,235,0.88)" }}>{status}</div>
              </div>

              {lastServerMessage ? (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", color: "rgba(229,231,235,0.78)" }}>
                    Last raw server message
                  </summary>
                  <pre style={{ marginTop: 8 }} className="errorBox">
                    {lastServerMessage}
                  </pre>
                </details>
              ) : null}
            </div>
          </details>

          {devMetricsEnabled ? (
            <details style={{ margin: "0 12px 12px" }}>
              <summary style={{ cursor: "pointer", color: "rgba(229,231,235,0.78)" }}>
                Dev: STT latency metrics
              </summary>
              <div style={{ paddingTop: 10 }}>
                <div
                  style={{
                    marginTop: 2,
                    display: "grid",
                    gridTemplateColumns: "260px 1fr",
                    rowGap: 6,
                  }}
                >
                  <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>
                    Time to first <span className="mono">stt.partial</span>
                  </div>
                  <div className="mono">{fmtMs(firstPartialLatencyMs)}</div>

                  <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>
                    <span className="mono">stt.partial</span> count
                  </div>
                  <div className="mono">{String(devMetrics.sttPartialCount)}</div>

                  <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>
                    Audio age now (<span className="mono">now - lastClientTimestampMsSent</span>)
                  </div>
                  <div className="mono">{fmtMs(audioAgeNowMs)}</div>

                  <div style={{ opacity: 0.7, color: "rgba(229,231,235,0.75)" }}>
                    Audio age at last <span className="mono">stt.partial</span> receive
                  </div>
                  <div className="mono">{fmtMs(devMetrics.lastAudioAgeAtSttPartialMs)}</div>
                </div>

                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn btnSmall" type="button" onClick={resetDevMetrics}>
                    Reset metrics
                  </button>
                </div>
              </div>
            </details>
          ) : null}
        </div>

        <TranscriptView state={state} />

        <p className="subtitle" style={{ marginTop: 12 }}>
          Configure default WS URL via <span className="mono">VITE_WS_URL</span>. This UI works without audio capture
          running; you can also use the dev mock generator.
        </p>
      </div>
    </div>
  );
}

