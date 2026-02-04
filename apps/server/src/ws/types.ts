import type { AudioFrame, ClientHello } from "@livetranslate/shared";
import type WebSocket from "ws";

export type SessionStatus = "connected" | "disconnected" | "stopped";

export type Session = {
  id: string;
  status: SessionStatus;
  socket: WebSocket | null;
  hello: ClientHello;
  /**
   * Async ingestion queue length in frames (not bytes).
   * See `BACKPRESSURE_POLICY` in `sessionRegistry.ts`.
   */
  queuedFrames: number;
  enqueueAudioFrame: (frame: AudioFrame) => { accepted: boolean; dropped: number };
  stop: (reason?: string) => void;
};

export type AudioFrameConsumer = (args: {
  session: Session;
  frame: AudioFrame;
}) => void | Promise<void>;

export type SessionStopConsumer = (args: {
  sessionId: string;
  reason?: string;
}) => void | Promise<void>;

