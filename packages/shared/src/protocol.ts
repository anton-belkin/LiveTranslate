import { z } from "zod";

export const PROTOCOL_VERSION = 1 as const;

/**
 * WebSocket envelope: every message is `{ type, ...payload }`.
 * This file is the source of truth for all cross-module communication.
 */

// ----------------------------
// Shared primitives
// ----------------------------

export const LangSchema = z.enum(["de", "en", "ru"]);
export type Lang = z.infer<typeof LangSchema>;

export const IdSchema = z.string().min(1);
export type Id = z.infer<typeof IdSchema>;

export const TimestampMsSchema = z.number().int().nonnegative();
export type TimestampMs = z.infer<typeof TimestampMsSchema>;

export const PcmFormatSchema = z.enum(["pcm_s16le"]);
export type PcmFormat = z.infer<typeof PcmFormatSchema>;

// ----------------------------
// Client -> Server
// ----------------------------

export const ClientHelloSchema = z.object({
  type: z.literal("client.hello"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  /**
   * Optional: allow UI to configure which columns are treated as LANG1/LANG2.
   * For this PoC, default is de/en.
   */
  langs: z
    .object({
      lang1: LangSchema.default("de"),
      lang2: LangSchema.default("en"),
    })
    .optional(),
  /**
   * For debugging/telemetry only (do not rely on it for security decisions).
   */
  client: z
    .object({
      userAgent: z.string().optional(),
    })
    .optional(),
});
export type ClientHello = z.infer<typeof ClientHelloSchema>;

export const AudioFrameSchema = z.object({
  type: z.literal("audio.frame"),
  /**
   * Unique per client session. Can be generated client-side.
   */
  sessionId: IdSchema,
  /**
   * Base64 of little-endian mono PCM16 audio bytes.
   */
  pcm16Base64: z.string().min(1),
  format: PcmFormatSchema.default("pcm_s16le"),
  sampleRateHz: z.number().int().positive(),
  channels: z.literal(1),
  /**
   * Optional: client-side timestamp for latency diagnostics.
   */
  clientTimestampMs: TimestampMsSchema.optional(),
});
export type AudioFrame = z.infer<typeof AudioFrameSchema>;

export const ClientStopSchema = z.object({
  type: z.literal("client.stop"),
  sessionId: IdSchema,
  reason: z.string().optional(),
});
export type ClientStop = z.infer<typeof ClientStopSchema>;

export const ClientToServerSchema = z.discriminatedUnion("type", [
  ClientHelloSchema,
  AudioFrameSchema,
  ClientStopSchema,
]);
export type ClientToServerMessage = z.infer<typeof ClientToServerSchema>;

// ----------------------------
// Server -> Client
// ----------------------------

export const ServerReadySchema = z.object({
  type: z.literal("server.ready"),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  sessionId: IdSchema,
});
export type ServerReady = z.infer<typeof ServerReadySchema>;

export const TurnStartSchema = z.object({
  type: z.literal("turn.start"),
  sessionId: IdSchema,
  turnId: IdSchema,
  startMs: TimestampMsSchema,
  /**
   * Optional diarization later.
   */
  speakerId: IdSchema.optional(),
});
export type TurnStart = z.infer<typeof TurnStartSchema>;

export const TurnFinalSchema = z.object({
  type: z.literal("turn.final"),
  sessionId: IdSchema,
  turnId: IdSchema,
  startMs: TimestampMsSchema,
  endMs: TimestampMsSchema,
  speakerId: IdSchema.optional(),
});
export type TurnFinal = z.infer<typeof TurnFinalSchema>;

export const SttPartialSchema = z.object({
  type: z.literal("stt.partial"),
  sessionId: IdSchema,
  turnId: IdSchema,
  segmentId: IdSchema,
  lang: LangSchema.optional(),
  text: z.string(),
  startMs: TimestampMsSchema,
});
export type SttPartial = z.infer<typeof SttPartialSchema>;

export const SttFinalSchema = z.object({
  type: z.literal("stt.final"),
  sessionId: IdSchema,
  turnId: IdSchema,
  segmentId: IdSchema,
  lang: LangSchema.optional(),
  text: z.string(),
  startMs: TimestampMsSchema,
  endMs: TimestampMsSchema,
});
export type SttFinal = z.infer<typeof SttFinalSchema>;

export const TranslatePartialSchema = z.object({
  type: z.literal("translate.partial"),
  sessionId: IdSchema,
  turnId: IdSchema,
  segmentId: IdSchema,
  from: LangSchema,
  to: LangSchema,
  /**
   * Streaming delta for the translated text.
   */
  textDelta: z.string(),
});
export type TranslatePartial = z.infer<typeof TranslatePartialSchema>;

export const TranslateFinalSchema = z.object({
  type: z.literal("translate.final"),
  sessionId: IdSchema,
  turnId: IdSchema,
  segmentId: IdSchema,
  from: LangSchema,
  to: LangSchema,
  text: z.string(),
});
export type TranslateFinal = z.infer<typeof TranslateFinalSchema>;

/**
 * Optional future: used for partial translation that revises earlier output.
 * Client should replace the displayed translation for this segment.
 */
export const TranslateReviseSchema = z.object({
  type: z.literal("translate.revise"),
  sessionId: IdSchema,
  turnId: IdSchema,
  segmentId: IdSchema,
  from: LangSchema,
  to: LangSchema,
  revision: z.number().int().nonnegative(),
  fullText: z.string(),
});
export type TranslateRevise = z.infer<typeof TranslateReviseSchema>;

export const ServerErrorSchema = z.object({
  type: z.literal("server.error"),
  sessionId: IdSchema.optional(),
  code: z.string(),
  message: z.string(),
  recoverable: z.boolean().default(false),
});
export type ServerError = z.infer<typeof ServerErrorSchema>;

export const ServerToClientSchema = z.discriminatedUnion("type", [
  ServerReadySchema,
  TurnStartSchema,
  TurnFinalSchema,
  SttPartialSchema,
  SttFinalSchema,
  TranslatePartialSchema,
  TranslateFinalSchema,
  TranslateReviseSchema,
  ServerErrorSchema,
]);
export type ServerToClientMessage = z.infer<typeof ServerToClientSchema>;

// ----------------------------
// Helpers
// ----------------------------

export function safeParseClientMessage(data: unknown) {
  return ClientToServerSchema.safeParse(data);
}

export function safeParseServerMessage(data: unknown) {
  return ServerToClientSchema.safeParse(data);
}

