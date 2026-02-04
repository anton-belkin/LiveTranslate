/**
 * Minimal AudioWorklet global typings for TypeScript.
 *
 * TypeScript's default DOM libs don't always include the processor-global
 * declarations (AudioWorkletGlobalScope). We keep this tiny and local.
 */

declare const sampleRate: number;

declare function registerProcessor(
  name: string,
  processorCtor: new (...args: any[]) => AudioWorkletProcessor,
): void;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: any);
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

