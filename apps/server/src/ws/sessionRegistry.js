import { randomUUID } from "node:crypto";
import WebSocket from "ws";
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
    dropStrategy: "drop_oldest_keep_latest",
};
const RECONNECT_TTL_MS = 60_000;
export function createSessionRegistry(args) {
    const sessions = new Map();
    function scheduleCleanup(session) {
        if (session._reconnectTimer)
            return;
        session._reconnectTimer = setTimeout(() => {
            sessions.delete(session.id);
        }, RECONNECT_TTL_MS);
    }
    function cancelCleanup(session) {
        if (!session._reconnectTimer)
            return;
        clearTimeout(session._reconnectTimer);
        session._reconnectTimer = null;
    }
    async function drain(session) {
        if (session._draining)
            return;
        session._draining = true;
        try {
            while (session._queue.length > 0 && session.status !== "stopped") {
                session.queuedFrames = session._queue.length;
                const frame = session._queue.shift();
                if (!frame)
                    continue;
                const consumers = session._consumers;
                if (consumers.length === 0)
                    continue;
                await Promise.all(consumers.map((c) => c({ session, frame })));
            }
        }
        finally {
            session.queuedFrames = session._queue.length;
            session._draining = false;
        }
    }
    function createNewSession(socket, hello) {
        const id = randomUUID();
        const session = {
            id,
            status: "connected",
            socket,
            hello,
            queuedFrames: 0,
            _queue: [],
            _draining: false,
            _consumers: args.consumers(),
            _reconnectTimer: null,
            enqueueAudioFrame(frame) {
                if (session.status === "stopped")
                    return { accepted: false, dropped: 0 };
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
            stop(reason) {
                session.status = "stopped";
                session._queue.length = 0;
                session.queuedFrames = 0;
                cancelCleanup(session);
                try {
                    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
                        session.socket.close(1000, reason);
                    }
                }
                catch {
                    // best-effort close
                }
                session.socket = null;
            },
        };
        sessions.set(id, session);
        return session;
    }
    function getSession(sessionId) {
        return sessions.get(sessionId);
    }
    function attachSocket(sessionId, socket) {
        const session = sessions.get(sessionId);
        if (!session)
            return undefined;
        if (session.status === "stopped")
            return undefined;
        cancelCleanup(session);
        session.socket = socket;
        session.status = "connected";
        return session;
    }
    function markDisconnected(sessionId) {
        const session = sessions.get(sessionId);
        if (!session)
            return;
        if (session.status === "stopped")
            return;
        session.status = "disconnected";
        session.socket = null;
        scheduleCleanup(session);
    }
    function stopAndDelete(sessionId, reason) {
        const session = sessions.get(sessionId);
        if (!session)
            return;
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
