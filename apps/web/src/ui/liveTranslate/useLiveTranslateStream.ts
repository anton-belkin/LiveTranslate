import { useCallback, useRef, type Dispatch } from "react";

import {
  PROTOCOL_VERSION,
  safeParseServerMessage,
  type AudioFrame,
  type ClientHello,
  type Lang,
} from "@livetranslate/shared";

import { startMicStreamer, type MicStreamerHandle } from "../../audio/micStreamer";
import { base64FromArrayBuffer } from "../../lib/base64";
import type { TranscriptAction } from "./store";

const DEBUG_LOGS = import.meta.env.VITE_DEBUG_LOGS === "true";

function debugLog(payload: Record<string, unknown>) {
  if (!DEBUG_LOGS) return;
  fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

type UseLiveTranslateStreamArgs = {
  url: string;
  dispatch: Dispatch<TranscriptAction>;
  targetLangs: Lang[];
  staticContext?: string;
  specialWords?: string[];
  specialWordsBoost?: number;
  audioSource: "mic" | "tab" | "both";
};

function makeHello(args: {
  targetLangs: Lang[];
  staticContext?: string;
  specialWords?: string[];
  specialWordsBoost?: number;
}): ClientHello {
  const targetLangs = args.targetLangs.length > 0 ? args.targetLangs : undefined;
  return {
    type: "client.hello",
    protocolVersion: PROTOCOL_VERSION,
    ...(targetLangs ? { targetLangs } : {}),
    staticContext: args.staticContext,
    specialWords: args.specialWords && args.specialWords.length > 0 ? args.specialWords : undefined,
    specialWordsBoost: args.specialWordsBoost,
    client: {
      userAgent: navigator.userAgent,
    },
  };
}

export function useLiveTranslateStream({
  url,
  dispatch,
  targetLangs,
  staticContext,
  specialWords,
  specialWordsBoost,
  audioSource,
}: UseLiveTranslateStreamArgs) {
  const socketRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicStreamerHandle | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const frameCountRef = useRef(0);

  const stopMic = useCallback(async () => {
    const mic = micRef.current;
    micRef.current = null;
    if (mic) await mic.stop();
  }, []);

  const startMic = useCallback(async () => {
    if (micRef.current) return;
    try {
      micRef.current = await startMicStreamer({
        audioSource,
        onFrame: (frame) => {
          const socket = socketRef.current;
          const sessionId = sessionIdRef.current;
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          if (!sessionId) return;

          frameCountRef.current += 1;
          if (frameCountRef.current === 1) {
            // #region agent log
            debugLog({
              location: "useLiveTranslateStream.ts:onFrame",
              message: "first audio frame",
              data: { sampleRateHz: frame.sampleRateHz, pcm16Bytes: frame.pcm16.byteLength },
              timestamp: Date.now(),
              sessionId: "debug-session",
              runId: "run1",
              hypothesisId: "H1",
            });
            // #endregion
          }

          const payload: AudioFrame = {
            type: "audio.frame",
            sessionId,
            pcm16Base64: base64FromArrayBuffer(frame.pcm16),
            format: "pcm_s16le",
            sampleRateHz: frame.sampleRateHz,
            channels: 1,
            clientTimestampMs: Date.now(),
          };

          try {
            socket.send(JSON.stringify(payload));
          } catch {
            // ignore send errors; socket handler will surface status
          }
        },
      });
      // #region agent log
      debugLog({
        location: "useLiveTranslateStream.ts:startMic",
        message: "mic started",
        data: {},
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "run1",
        hypothesisId: "H1",
      });
      // #endregion
    } catch (err) {
      // #region agent log
      debugLog({
        location: "useLiveTranslateStream.ts:startMic",
        message: "startMic error",
        data: {
          name: (err as Error | undefined)?.name ?? "unknown",
          message: String(err),
        },
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "run1",
        hypothesisId: "D",
      });
      // #endregion
      dispatch({
        type: "connection.update",
        status: "error",
        error: `Audio capture error: ${String(err)}`,
      });
    }
  }, [audioSource, dispatch]);

  const stop = useCallback(async () => {
    const socket = socketRef.current;
    const sessionId = sessionIdRef.current;
    if (socket && socket.readyState === WebSocket.OPEN && sessionId) {
      try {
        socket.send(JSON.stringify({ type: "client.stop", sessionId }));
      } catch {
        // ignore
      }
    }
    sessionIdRef.current = null;
    try {
      socket?.close();
    } catch {
      // ignore
    }
    socketRef.current = null;
    await stopMic();
  }, [stopMic]);

  const start = useCallback(async () => {
    if (socketRef.current) return;
    if (!url.trim()) {
      dispatch({
        type: "connection.update",
        status: "error",
        error: "Missing WebSocket URL.",
      });
      return;
    }

    dispatch({ type: "connection.update", status: "connecting" });

    const socket = new WebSocket(url);
    socketRef.current = socket;

    // Start capture from the user gesture so getDisplayMedia works (Safari/Chrome).
    void startMic();

    socket.onopen = () => {
      dispatch({ type: "connection.update", status: "open" });
      const hello = makeHello({ targetLangs, staticContext, specialWords, specialWordsBoost });
      socket.send(JSON.stringify(hello));
    };

    socket.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(ev.data));
      } catch (err) {
        dispatch({
          type: "connection.update",
          status: "error",
          error: `Invalid JSON from server: ${String(err)}`,
        });
        return;
      }

      const res = safeParseServerMessage(parsed);
      if (!res.success) {
        dispatch({
          type: "connection.update",
          status: "error",
          error: "Server message did not match protocol schema.",
        });
        return;
      }

      // #region agent log
      debugLog({
        location: "useLiveTranslateStream.ts:onmessage",
        message: "ws message received",
        data: {
          type: res.data.type,
          hasText:
            "text" in res.data && typeof (res.data as { text?: string }).text === "string"
              ? (res.data as { text?: string }).text.length
              : undefined,
          hasDelta:
            "textDelta" in res.data &&
            typeof (res.data as { textDelta?: string }).textDelta === "string"
              ? (res.data as { textDelta?: string }).textDelta.length
              : undefined,
          lang: "lang" in res.data ? (res.data as { lang?: string }).lang : undefined,
          from: "from" in res.data ? (res.data as { from?: string }).from : undefined,
          to: "to" in res.data ? (res.data as { to?: string }).to : undefined,
        },
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "run1",
        hypothesisId: "H1",
      });
      // #endregion

      if (res.data.type === "server.ready") {
        sessionIdRef.current = res.data.sessionId;
      }

      dispatch({ type: "server.message", message: res.data });
    };

    socket.onerror = () => {
      dispatch({
        type: "connection.update",
        status: "error",
        error: "WebSocket error.",
      });
    };

    socket.onclose = () => {
      socketRef.current = null;
      sessionIdRef.current = null;
      dispatch({ type: "connection.update", status: "closed" });
      void stopMic();
    };
  }, [dispatch, startMic, stopMic, url, targetLangs, staticContext, specialWords, specialWordsBoost]);

  return { start, stop };
}
