import type { TimestampMs } from "./protocol.js";

/**
 * Segmentation is a server-side concern: it decides how to group streaming STT
 * into distinct turn blocks so the UI doesn't merge consecutive speakers.
 *
 * This file defines the state machine + tunables. Implementation lives in server.
 */

export const DEFAULT_SILENCE_GAP_MS = 650;
export const DEFAULT_MAX_TURN_MS = 15_000;

export type TurnState = "open" | "final";

export type Turn = {
  turnId: string;
  state: TurnState;
  startMs: TimestampMs;
  endMs?: TimestampMs;
  speakerId?: string;
};

export type SegmentState = "partial" | "final";

export type Segment = {
  segmentId: string;
  turnId: string;
  state: SegmentState;
  startMs: TimestampMs;
  endMs?: TimestampMs;
  text: string;
};

export type SegmentationTuning = {
  /**
   * If no new speech is detected for this long, close the current turn and open
   * a new one upon next speech.
   */
  silenceGapMs: number;
  /**
   * Prevent mega-paragraphs; forces a turn boundary.
   */
  maxTurnMs: number;
};

export const DEFAULT_SEGMENTATION_TUNING: SegmentationTuning = {
  silenceGapMs: DEFAULT_SILENCE_GAP_MS,
  maxTurnMs: DEFAULT_MAX_TURN_MS,
};

