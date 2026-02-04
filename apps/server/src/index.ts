import { createWsServer } from "./ws/server.js";
import { registerOpenAiStt } from "./stt/registerOpenAiStt.js";

const port = Number(process.env.PORT ?? 8787);

const ws = createWsServer({ port });

// STT-only milestone: wire streaming transcription into the WS audio pipeline.
registerOpenAiStt(ws);

// eslint-disable-next-line no-console
console.log(`WS server listening on ws://localhost:${port}`);

