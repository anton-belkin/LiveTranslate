import { useCallback, useRef, type Dispatch } from "react";

import {
  PROTOCOL_VERSION,
  safeParseServerMessage,
  type AudioFrame,
  type ClientHello,
} from "@livetranslate/shared";

import { startMicStreamer, type MicStreamerHandle } from "../../audio/micStreamer";
import { base64FromArrayBuffer } from "../../lib/base64";
import type { TranscriptAction } from "./store";

type UseLiveTranslateStreamArgs = {
  url: string;
  dispatch: Dispatch<TranscriptAction>;
};

function makeHello(): ClientHello {
  const enableRu =
    typeof window !== "undefined" &&
    ["1", "true", "yes"].includes(
      new URLSearchParams(window.location.search).get("ru")?.toLowerCase() ?? "",
    );
  return {
    type: "client.hello",
    protocolVersion: PROTOCOL_VERSION,
    langs: { lang1: "de", lang2: "en" },
    enableRu,
    client: {
      userAgent: navigator.userAgent,
    },
  };
}

export function useLiveTranslateStream({ url, dispatch }: UseLiveTranslateStreamArgs) {
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
        onFrame: (frame) => {
          const socket = socketRef.current;
          const sessionId = sessionIdRef.current;
          if (!socket || socket.readyState !== WebSocket.OPEN) return;
          if (!sessionId) return;

          frameCountRef.current += 1;
          if (frameCountRef.current === 1) {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLiveTranslateStream.ts:onFrame',message:'first audio frame',data:{sampleRateHz:frame.sampleRateHz,pcm16Bytes:frame.pcm16.byteLength},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
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
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLiveTranslateStream.ts:startMic',message:'mic started',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'H1'})}).catch(()=>{});
      // #endregion
    } catch (err) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'useLiveTranslateStream.ts:startMic',message:'startMic error',data:{name:(err as Error | undefined)?.name ?? "unknown",message:String(err)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      dispatch({
        type: "connection.update",
        status: "error",
        error: `Microphone error: ${String(err)}`,
      });
    }
  }, [dispatch]);

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

    socket.onopen = () => {
      dispatch({ type: "connection.update", status: "open" });
      socket.send(JSON.stringify(makeHello()));
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
      const msg = res.data;
      if (!msg) return;
      if (msg.type === "server.ready") {
        sessionIdRef.current = msg.sessionId;
        void startMic();
      }

      dispatch({ type: "server.message", message: msg });
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
  }, [dispatch, startMic, stopMic, url]);

  return { start, stop };
}
