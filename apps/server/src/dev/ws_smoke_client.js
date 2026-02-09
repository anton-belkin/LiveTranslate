/**
 * Minimal WS smoke client for local testing.
 *
 * Usage:
 *   pnpm -C apps/server dev
 *   node --loader tsx apps/server/src/dev/ws_smoke_client.ts --url ws://localhost:8787
 *
 * Optional: stream a PCM16 mono WAV file:
 *   node --loader tsx apps/server/src/dev/ws_smoke_client.ts --wav path/to/file.wav
 */
import WebSocket from "ws";
import { PROTOCOL_VERSION } from "@livetranslate/shared";
import { readFileSync } from "node:fs";
function argValue(name) {
    const idx = process.argv.indexOf(name);
    if (idx === -1)
        return undefined;
    return process.argv[idx + 1];
}
const url = argValue("--url") ?? "ws://localhost:8787";
const wavPath = argValue("--wav");
function parseWavPcm16Mono(buf) {
    // Very small WAV parser: PCM (format 1), mono, 16-bit.
    const riff = buf.toString("ascii", 0, 4);
    const wave = buf.toString("ascii", 8, 12);
    if (riff !== "RIFF" || wave !== "WAVE")
        throw new Error("Not a WAV file");
    let offset = 12;
    let sampleRateHz = 0;
    let channels = 0;
    let bitsPerSample = 0;
    let audioFormat = 0;
    let dataOffset = -1;
    let dataSize = 0;
    while (offset + 8 <= buf.length) {
        const id = buf.toString("ascii", offset, offset + 4);
        const size = buf.readUInt32LE(offset + 4);
        const chunkStart = offset + 8;
        if (id === "fmt ") {
            audioFormat = buf.readUInt16LE(chunkStart + 0);
            channels = buf.readUInt16LE(chunkStart + 2);
            sampleRateHz = buf.readUInt32LE(chunkStart + 4);
            bitsPerSample = buf.readUInt16LE(chunkStart + 14);
        }
        else if (id === "data") {
            dataOffset = chunkStart;
            dataSize = size;
            break;
        }
        offset = chunkStart + size + (size % 2);
    }
    if (audioFormat !== 1)
        throw new Error(`Unsupported WAV format=${audioFormat}`);
    if (channels !== 1)
        throw new Error(`Expected mono WAV, got channels=${channels}`);
    if (bitsPerSample !== 16)
        throw new Error(`Expected 16-bit WAV, got ${bitsPerSample}`);
    if (dataOffset < 0)
        throw new Error("WAV missing data chunk");
    const pcm16 = new Uint8Array(buf.buffer, buf.byteOffset + dataOffset, dataSize);
    return { sampleRateHz, pcm16 };
}
function uint8ToBase64(bytes) {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");
}
const ws = new WebSocket(url);
let sessionId = null;
ws.on("open", () => {
    ws.send(JSON.stringify({
        type: "client.hello",
        protocolVersion: PROTOCOL_VERSION,
        client: { userAgent: "ws_smoke_client" },
    }));
});
ws.on("message", (data) => {
    const txt = data.toString();
    const msg = JSON.parse(txt);
    // eslint-disable-next-line no-console
    console.log("<= ", msg);
    if (msg.type === "server.ready") {
        sessionId = msg.sessionId;
        if (!wavPath) {
            // If no WAV is provided, send a few silent frames to validate the pipeline.
            const sampleRateHz = 16_000;
            const frameSamples = Math.floor(sampleRateHz * 0.02); // ~20ms
            const silence = new Uint8Array(frameSamples * 2);
            let sent = 0;
            const interval = setInterval(() => {
                if (!sessionId)
                    return;
                const frame = {
                    type: "audio.frame",
                    sessionId,
                    pcm16Base64: uint8ToBase64(silence),
                    format: "pcm_s16le",
                    sampleRateHz,
                    channels: 1,
                };
                ws.send(JSON.stringify(frame));
                sent += 1;
                if (sent >= 20) {
                    clearInterval(interval);
                    ws.send(JSON.stringify({ type: "client.stop", sessionId, reason: "done" }));
                }
            }, 20);
        }
        else {
            const wav = readFileSync(wavPath);
            const { sampleRateHz, pcm16 } = parseWavPcm16Mono(wav);
            const frameBytes = Math.floor(sampleRateHz * 0.02) * 2; // 20ms
            let offset = 0;
            const interval = setInterval(() => {
                if (!sessionId)
                    return;
                if (offset >= pcm16.byteLength) {
                    clearInterval(interval);
                    ws.send(JSON.stringify({ type: "client.stop", sessionId, reason: "wav_done" }));
                    return;
                }
                const chunk = pcm16.subarray(offset, Math.min(pcm16.byteLength, offset + frameBytes));
                offset += chunk.byteLength;
                const frame = {
                    type: "audio.frame",
                    sessionId,
                    pcm16Base64: uint8ToBase64(chunk),
                    format: "pcm_s16le",
                    sampleRateHz,
                    channels: 1,
                };
                ws.send(JSON.stringify(frame));
            }, 20);
        }
    }
});
ws.on("close", () => {
    // eslint-disable-next-line no-console
    console.log("WS closed");
});
ws.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("WS error", err);
});
