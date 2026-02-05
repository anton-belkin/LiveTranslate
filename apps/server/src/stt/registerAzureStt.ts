import type { WsServerApi } from "../ws/server.js";
import { base64ToUint8Array } from "../util/base64.js";
import { AzureSpeechSttAdapter } from "./azure/azureSpeechSttAdapter.js";
import { loadAzureSpeechConfig } from "./azure/config.js";

const DEFAULT_IDLE_STOP_MS = 30_000;

type Entry = {
  adapter: AzureSpeechSttAdapter;
  idleTimer: NodeJS.Timeout | null;
  lastFrameAt: number;
};

/**
 * Plug Azure Speech STT + MT into the WS server audio frame pipeline.
 *
 * Lifecycle:
 * - Adapters are created lazily on first audio frame per session.
 * - If a session goes idle (no frames) we stop and GC its adapter.
 * - Reconnect is handled by WS layer; emits will go to the "current" socket.
 */
export function registerAzureStt(ws: WsServerApi) {
  const entries = new Map<string, Entry>();
  const config = loadAzureSpeechConfig();

  function ensureEntry(sessionId: string) {
    const existing = entries.get(sessionId);
    if (existing) return existing;

    const adapter = new AzureSpeechSttAdapter({
      sessionId,
      config,
      emit: (msg) => {
        ws.emitToSession(sessionId, msg);
      },
      onError: (err) => {
        ws.emitToSession(sessionId, {
          type: "server.error",
          sessionId,
          code: "stt_error",
          message: err.message,
          recoverable: true,
        });
      },
    });

    adapter.start();

    const entry: Entry = {
      adapter,
      idleTimer: null,
      lastFrameAt: Date.now(),
    };
    entries.set(sessionId, entry);
    return entry;
  }

  function scheduleIdleStop(sessionId: string, entry: Entry) {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      const cur = entries.get(sessionId);
      if (!cur) return;
      const idleFor = Date.now() - cur.lastFrameAt;
      if (idleFor < DEFAULT_IDLE_STOP_MS) {
        scheduleIdleStop(sessionId, cur);
        return;
      }
      void cur.adapter.stop({ reason: "idle_timeout" });
      entries.delete(sessionId);
    }, DEFAULT_IDLE_STOP_MS);
  }

  const unsubscribe = ws.registerAudioFrameConsumer(({ session, frame }) => {
    const entry = ensureEntry(session.id);
    entry.lastFrameAt = Date.now();
    scheduleIdleStop(session.id, entry);

    const pcm16 = base64ToUint8Array(frame.pcm16Base64);
    entry.adapter.pushAudioFrame({ pcm16, sampleRateHz: frame.sampleRateHz });
  });

  const unsubscribeStop = ws.registerSessionStopConsumer(({ sessionId, reason }) => {
    const entry = entries.get(sessionId);
    if (!entry) return;
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    void entry.adapter.stop({ reason: reason ?? "client_stop" });
    entries.delete(sessionId);
  });

  return () => {
    unsubscribe();
    unsubscribeStop();
    for (const [sessionId, entry] of entries) {
      if (entry.idleTimer) clearTimeout(entry.idleTimer);
      void entry.adapter.stop({ reason: "server_shutdown" });
      entries.delete(sessionId);
    }
  };
}

