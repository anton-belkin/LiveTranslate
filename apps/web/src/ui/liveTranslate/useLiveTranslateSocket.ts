import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  PROTOCOL_VERSION,
  safeParseServerMessage,
  type ClientHello,
  type ServerToClientMessage,
} from "@livetranslate/shared";

export type SocketStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

export type UseLiveTranslateSocketArgs = {
  url: string;
  enabled: boolean;
  onServerMessage: (msg: ServerToClientMessage) => void;
  onSocketStatus: (status: SocketStatus, error?: string) => void;
};

function makeHello(): ClientHello {
  return {
    type: "client.hello",
    protocolVersion: PROTOCOL_VERSION,
    langs: { lang1: "de", lang2: "en" },
    client: {
      userAgent: navigator.userAgent,
    },
  };
}

export function useLiveTranslateSocket({
  url,
  enabled,
  onServerMessage,
  onSocketStatus,
}: UseLiveTranslateSocketArgs) {
  const socketRef = useRef<WebSocket | null>(null);
  const [instanceKey, setInstanceKey] = useState(0);

  const disconnect = useCallback(() => {
    const ws = socketRef.current;
    socketRef.current = null;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      ws.close();
    }
  }, []);

  const reconnect = useCallback(() => {
    disconnect();
    setInstanceKey((k) => k + 1);
  }, [disconnect]);

  const canConnect = useMemo(() => enabled && url.trim().length > 0, [enabled, url]);

  useEffect(() => {
    if (!canConnect) {
      disconnect();
      onSocketStatus("idle");
      return;
    }

    onSocketStatus("connecting");
    let closedByCleanup = false;

    const ws = new WebSocket(url);
    socketRef.current = ws;

    ws.onopen = () => {
      if (closedByCleanup) return;
      onSocketStatus("open");
      ws.send(JSON.stringify(makeHello()));
    };

    ws.onmessage = (ev) => {
      if (closedByCleanup) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(ev.data));
      } catch (err) {
        onSocketStatus("error", `Invalid JSON from server: ${String(err)}`);
        return;
      }

      const res = safeParseServerMessage(parsed);
      if (!res.success) {
        onSocketStatus("error", "Server message did not match protocol schema.");
        return;
      }
      onServerMessage(res.data);
    };

    ws.onerror = () => {
      if (closedByCleanup) return;
      onSocketStatus("error", "WebSocket error.");
    };

    ws.onclose = (ev) => {
      if (closedByCleanup) return;
      onSocketStatus("closed");
    };

    return () => {
      closedByCleanup = true;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canConnect, url, instanceKey]);

  return { reconnect, disconnect };
}

