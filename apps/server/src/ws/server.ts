import WebSocket, { WebSocketServer } from "ws";
import type http from "node:http";
import {
  PROTOCOL_VERSION,
  safeParseClientMessage,
  safeParseServerMessage,
  type AudioFrame,
  type ClientHello,
  type ServerToClientMessage,
} from "@livetranslate/shared";
import { createSessionRegistry } from "./sessionRegistry.js";
import type { AudioFrameConsumer, Session, SessionStopConsumer } from "./types.js";

const DEBUG_LOGS = process.env.LIVETRANSLATE_DEBUG_LOGS === "true";

function debugLog(payload: Record<string, unknown>) {
  if (!DEBUG_LOGS) return;
  fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {});
}

function safeJsonParse(input: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(input) as unknown };
  } catch {
    return { ok: false };
  }
}

function toText(data: WebSocket.RawData): string | null {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return null;
}

export type WsServerApi = {
  /**
   * Emit a typed protocol message to a session's current socket.
   * Returns false if the session/socket is not currently writable.
   */
  emitToSession: (sessionId: string, msg: ServerToClientMessage) => boolean;
  /**
   * Register an async consumer for accepted audio frames.
   * STT can plug in here without touching WS wiring.
   */
  registerAudioFrameConsumer: (consumer: AudioFrameConsumer) => () => void;
  /**
   * Register a callback invoked when a session is explicitly stopped
   * (e.g. `client.stop` or server-side replacement on resume).
   */
  registerSessionStopConsumer: (consumer: SessionStopConsumer) => () => void;
};

export function createWsServer(args: { server: http.Server }): WsServerApi {
  const wss = new WebSocketServer({ server: args.server });

  const audioFrameConsumers: AudioFrameConsumer[] = [];
  const sessionStopConsumers: SessionStopConsumer[] = [];
  const lastBackpressureErrorAtBySession = new Map<string, number>();
  const firstAudioFrameBySession = new Set<string>();
  const registry = createSessionRegistry({
    consumers: () => audioFrameConsumers,
  });

  function emitToSocket(socket: WebSocket, msg: ServerToClientMessage) {
    const parsed = safeParseServerMessage(msg);
    if (!parsed.success) {
      // #region agent log
      debugLog({
        location: "server.ts:emitToSocket",
        message: "server msg failed schema",
        data: {
          type: (msg as { type?: string }).type ?? null,
          issueCount: parsed.error.issues.length,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path,
            code: issue.code,
            message: issue.message,
            expected: issue.expected,
            received: issue.received,
          })),
        },
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "run1",
        hypothesisId: "H4",
      });
      // #endregion
      return false;
    }
    if (socket.readyState !== WebSocket.OPEN) {
      // #region agent log
      debugLog({
        location: "server.ts:emitToSocket",
        message: "socket not open",
        data: { type: parsed.data.type, readyState: socket.readyState },
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "run1",
        hypothesisId: "H4",
      });
      // #endregion
      return false;
    }
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch {
      // #region agent log
      debugLog({
        location: "server.ts:emitToSocket",
        message: "socket.send threw",
        data: { type: parsed.data.type },
        timestamp: Date.now(),
        sessionId: "debug-session",
        runId: "run1",
        hypothesisId: "H4",
      });
      // #endregion
      return false;
    }
  }

  function emitToSession(sessionId: string, msg: ServerToClientMessage) {
    const session = registry.getSession(sessionId);
    const socket = session?.socket;
    if (!socket) return false;
    return emitToSocket(socket, msg);
  }

  function sendError(socket: WebSocket, args: { sessionId?: string; code: string; message: string; recoverable?: boolean }) {
    const payload: ServerToClientMessage = {
      type: "server.error",
      sessionId: args.sessionId,
      code: args.code,
      message: args.message,
      recoverable: args.recoverable ?? false,
    };
    emitToSocket(socket, payload);
  }

  function notifySessionStopped(sessionId: string, reason?: string) {
    if (sessionStopConsumers.length === 0) return;
    void Promise.all(
      sessionStopConsumers.map(async (c) => {
        try {
          await c({ sessionId, reason });
        } catch {
          // ignore; cleanup is best-effort
        }
      }),
    );
  }

  function handleHello(socket: WebSocket, msg: ClientHello): Session {
    const session = registry.createNewSession(socket, msg);
    emitToSocket(socket, {
      type: "server.ready",
      protocolVersion: PROTOCOL_VERSION,
      sessionId: session.id,
      targetLangs: msg.targetLangs,
    });
    return session;
  }

  function tryResumeSession(args: { socket: WebSocket; sessionId: string }) {
    const existing = registry.attachSocket(args.sessionId, args.socket);
    if (!existing) return undefined;
    emitToSocket(args.socket, {
      type: "server.ready",
      protocolVersion: PROTOCOL_VERSION,
      sessionId: existing.id,
      targetLangs: existing.hello.targetLangs,
    });
    return existing;
  }

  wss.on("connection", (socket) => {
    let helloReceived = false;
    let issuedSessionId: string | null = null;
    let boundSessionId: string | null = null;

    socket.on("message", (data) => {
      const text = toText(data);
      if (text === null) {
        sendError(socket, { code: "invalid_message", message: "Unsupported WebSocket message encoding.", recoverable: true });
        return;
      }

      const parsedJson = safeJsonParse(text);
      if (!parsedJson.ok) {
        sendError(socket, { code: "invalid_json", message: "Message must be valid JSON.", recoverable: true });
        return;
      }

      const parsedMsg = safeParseClientMessage(parsedJson.value);
      if (!parsedMsg.success) {
        sendError(socket, { code: "invalid_message", message: "Message does not match protocol schema.", recoverable: true });
        return;
      }

      const msg = parsedMsg.data;

      if (msg.type === "client.hello") {
        if (helloReceived) {
          sendError(socket, { sessionId: boundSessionId ?? undefined, code: "duplicate_hello", message: "client.hello was already received.", recoverable: true });
          return;
        }
        helloReceived = true;
        const session = handleHello(socket, msg);
        issuedSessionId = session.id;
        boundSessionId = session.id;
        return;
      }

      if (!helloReceived) {
        sendError(socket, { code: "hello_required", message: "Send client.hello before any other message.", recoverable: true });
        return;
      }

      if (msg.type === "client.stop") {
        const sid = boundSessionId ?? msg.sessionId;
        notifySessionStopped(sid, msg.reason ?? "client_stop");
        registry.stopAndDelete(sid, msg.reason);
        try {
          socket.close(1000, msg.reason);
        } catch {
          // ignore
        }
        return;
      }

      // audio.frame
      const frame: AudioFrame = msg;

      if (!firstAudioFrameBySession.has(frame.sessionId)) {
        firstAudioFrameBySession.add(frame.sessionId);
        // #region agent log
        debugLog({
          location: "server.ts:audio.frame",
          message: "first audio frame received",
          data: {
            sessionId: frame.sessionId,
            sampleRateHz: frame.sampleRateHz,
            bytes: frame.pcm16Base64.length,
          },
          timestamp: Date.now(),
          sessionId: "debug-session",
          runId: "run1",
          hypothesisId: "H2",
        });
        // #endregion
      }

      // Reconnect handling: allow clients to resume by sending audio.frame with a
      // previously issued sessionId, even if this connection was just created.
      if (boundSessionId !== frame.sessionId) {
        const resumed = tryResumeSession({ socket, sessionId: frame.sessionId });
        if (resumed) {
          if (issuedSessionId && issuedSessionId !== resumed.id) {
            // Avoid leaking the just-created session when the client resumes an older one.
            notifySessionStopped(issuedSessionId, "replaced_by_resume");
            registry.stopAndDelete(issuedSessionId, "replaced_by_resume");
          }
          boundSessionId = resumed.id;
        } else if (issuedSessionId && frame.sessionId === issuedSessionId) {
          // normal case: first frames use server-issued sessionId
          boundSessionId = issuedSessionId;
        } else {
          sendError(socket, {
            sessionId: boundSessionId ?? undefined,
            code: "session_mismatch",
            message: "audio.frame sessionId does not match an active/reconnectable session.",
            recoverable: true,
          });
          return;
        }
      }

      if (!boundSessionId) {
        sendError(socket, { code: "unknown_session", message: "No session is bound to this connection.", recoverable: true });
        return;
      }

      const session = registry.getSession(boundSessionId);
      if (!session) {
        sendError(socket, { code: "unknown_session", message: "Session not found (it may have expired). Reconnect and start again.", recoverable: true });
        return;
      }

      const { dropped } = session.enqueueAudioFrame(frame);
      if (dropped > 0) {
        const now = Date.now();
        const lastAt = lastBackpressureErrorAtBySession.get(session.id) ?? 0;
        // Best-effort signal; rate limit to avoid spamming.
        if (now - lastAt > 2000) {
          lastBackpressureErrorAtBySession.set(session.id, now);
          sendError(socket, {
            sessionId: session.id,
            code: "backpressure_drop",
            message: `Dropped audio frames due to backpressure (latest batch dropped=${dropped}).`,
            recoverable: true,
          });
        }
      }
    });

    socket.on("close", () => {
      if (boundSessionId) registry.markDisconnected(boundSessionId);
    });

    socket.on("error", () => {
      if (boundSessionId) registry.markDisconnected(boundSessionId);
    });
  });

  return {
    emitToSession,
    registerAudioFrameConsumer(consumer: AudioFrameConsumer) {
      audioFrameConsumers.push(consumer);
      return () => {
        const idx = audioFrameConsumers.indexOf(consumer);
        if (idx >= 0) audioFrameConsumers.splice(idx, 1);
      };
    },
    registerSessionStopConsumer(consumer: SessionStopConsumer) {
      sessionStopConsumers.push(consumer);
      return () => {
        const idx = sessionStopConsumers.indexOf(consumer);
        if (idx >= 0) sessionStopConsumers.splice(idx, 1);
      };
    },
  };
}

