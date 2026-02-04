/**
 * Placeholder server entrypoint.
 *
 * Agents will implement:
 * - WS server session lifecycle
 * - STT adapter
 * - Translation adapter
 *
 * Contracts are in `@livetranslate/shared`.
 */

import { WebSocketServer } from "ws";

const port = Number(process.env.PORT ?? 8787);

const wss = new WebSocketServer({ port });

wss.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "server.error",
      code: "not_implemented",
      message:
        "Server skeleton only. Implement session + STT + translation adapters.",
      recoverable: false,
    }),
  );
  socket.close();
});

// eslint-disable-next-line no-console
console.log(`WS server listening on ws://localhost:${port}`);

