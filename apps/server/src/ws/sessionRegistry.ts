import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import type { AudioFrame, ClientHello } from "@livetranslate/shared";
import type { AudioFrameConsumer, Session, SessionAuth } from "./types.js";

/**
 * Backpressure policy (documented requirement):
 * - **Queue is bounded** per session (frames, not bytes).
 * - When over capacity, we **drop the oldest frames** and keep the newest audio.
 *
 * Rationale: This is a low-latency product; delivering "most recent" audio is
 * more valuable than preserving history while the STT pipeline is behind.
 */
export const BACKPRESSURE_POLICY = {
  maxQueuedFrames: 50,
  dropStrategy: "drop_oldest_keep_latest" as const,
};

const RECONNECT_TTL_MS = 60_000;

type SessionInternal = Session & {
  _queue: AudioFrame[];
  _draining: boolean;
  _consumers: ReadonlyArray<AudioFrameConsumer>;
  _reconnectTimer: NodeJS.Timeout | null;
};

export type SessionRegistry = {
  createNewSession: (socket: WebSocket, hello: ClientHello, auth?: SessionAuth) => Session;
  getSession: (sessionId: string) => Session | undefined;
  attachSocket: (sessionId: string, socket: WebSocket) => Session | undefined;
  markDisconnected: (sessionId: string) => void;
  stopAndDelete: (sessionId: string, reason?: string) => void;
};

export function createSessionRegistry(args: {
  consumers: () => ReadonlyArray<AudioFrameConsumer>;
}): SessionRegistry {
  const sessions = new Map<string, SessionInternal>();

  function scheduleCleanup(session: SessionInternal) {
    if (session._reconnectTimer) return;
    session._reconnectTimer = setTimeout(() => {
      sessions.delete(session.id);
    }, RECONNECT_TTL_MS);
  }

  function cancelCleanup(session: SessionInternal) {
    if (!session._reconnectTimer) return;
    clearTimeout(session._reconnectTimer);
    session._reconnectTimer = null;
  }

  async function drain(session: SessionInternal) {
    if (session._draining) return;
    session._draining = true;
    try {
      while (session._queue.length > 0 && session.status !== "stopped") {
        session.queuedFrames = session._queue.length;
        const frame = session._queue.shift();
        if (!frame) continue;
        const consumers = session._consumers;
        if (consumers.length === 0) continue;
        await Promise.all(consumers.map((c) => c({ session, frame })));
      }
    } finally {
      session.queuedFrames = session._queue.length;
      session._draining = false;
    }
  }

  function createNewSession(socket: WebSocket, hello: ClientHello, auth?: SessionAuth): Session {
    const id = randomUUID();
    const session: SessionInternal = {
      id,
      status: "connected",
      socket,
      hello,
      auth,
      queuedFrames: 0,
      _queue: [],
      _draining: false,
      _consumers: args.consumers(),
      _reconnectTimer: null,
      enqueueAudioFrame(frame: AudioFrame) {
        if (session.status === "stopped") return { accepted: false, dropped: 0 };

        session._consumers = args.consumers();

        let dropped = 0;
        session._queue.push(frame);
        while (session._queue.length > BACKPRESSURE_POLICY.maxQueuedFrames) {
          session._queue.shift();
          dropped += 1;
        }

        void drain(session);
        return { accepted: true, dropped };
      },
      stop(reason?: string) {
        session.status = "stopped";
        session._queue.length = 0;
        session.queuedFrames = 0;
        cancelCleanup(session);

        try {
          if (session.socket && session.socket.readyState === WebSocket.OPEN) {
            session.socket.close(1000, reason);
          }
        } catch {
          // best-effort close
        }
        session.socket = null;
      },
    };

    sessions.set(id, session);
    return session;
  }

  function getSession(sessionId: string) {
    return sessions.get(sessionId);
  }

  function attachSocket(sessionId: string, socket: WebSocket) {
    const session = sessions.get(sessionId);
    if (!session) return undefined;
    if (session.status === "stopped") return undefined;
    cancelCleanup(session);
    session.socket = socket;
    session.status = "connected";
    return session;
  }

  function markDisconnected(sessionId: string) {
    const session = sessions.get(sessionId);
    if (!session) return;
    if (session.status === "stopped") return;
    session.status = "disconnected";
    session.socket = null;
    scheduleCleanup(session);
  }

  function stopAndDelete(sessionId: string, reason?: string) {
    const session = sessions.get(sessionId);
    if (!session) return;
    session.stop(reason);
    sessions.delete(sessionId);
  }

  return {
    createNewSession,
    getSession,
    attachSocket,
    markDisconnected,
    stopAndDelete,
  };
}

