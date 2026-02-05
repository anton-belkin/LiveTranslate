import { PROTOCOL_VERSION, type ClientHello, type ClientStop } from "@livetranslate/shared";

export type WsClientState = "idle" | "connecting" | "open" | "closed" | "error";

type WsClientOpts = {
  url: string;
  onState?: (state: WsClientState) => void;
  onServerMessage?: (data: unknown) => void;
  /**
   * If true, reconnect when the socket closes unexpectedly.
   * Backoff is capped and resets on successful open.
   */
  autoReconnect?: boolean;
};

export class WsClient {
  private url: string;
  private socket: WebSocket | null = null;
  private state: WsClientState = "idle";
  private onState?: WsClientOpts["onState"];
  private onServerMessage?: WsClientOpts["onServerMessage"];
  private autoReconnect: boolean;
  private reconnectTimer: number | null = null;
  private reconnectAttempt = 0;
  private closedByClient = false;

  constructor(opts: WsClientOpts) {
    this.url = opts.url;
    this.onState = opts.onState;
    this.onServerMessage = opts.onServerMessage;
    this.autoReconnect = opts.autoReconnect ?? true;
  }

  getState() {
    return this.state;
  }

  connect() {
    if (this.socket && (this.state === "open" || this.state === "connecting")) return;

    this.closedByClient = false;
    this.setState("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.setState("open");
      const enableRu =
        typeof window !== "undefined" &&
        ["1", "true", "yes"].includes(
          new URLSearchParams(window.location.search).get("ru")?.toLowerCase() ?? "",
        );
      const hello: ClientHello = {
        type: "client.hello",
        protocolVersion: PROTOCOL_VERSION,
        langs: { lang1: "de", lang2: "en" },
        enableRu,
        client: { userAgent: navigator.userAgent },
      };
      this.sendJson(hello);
    };

    socket.onmessage = (ev) => {
      let parsed: unknown = ev.data;
      if (typeof ev.data === "string") {
        try {
          parsed = JSON.parse(ev.data) as unknown;
        } catch {
          // ignore parse errors; raw string forwarded
        }
      }
      this.onServerMessage?.(parsed);
    };

    socket.onerror = () => {
      this.setState("error");
    };

    socket.onclose = () => {
      this.socket = null;
      this.setState("closed");

      if (!this.closedByClient && this.autoReconnect) this.scheduleReconnect();
    };
  }

  sendJson(data: unknown) {
    if (!this.socket || this.state !== "open") return false;
    this.socket.send(JSON.stringify(data));
    return true;
  }

  stop(sessionId: string, reason?: string) {
    const msg: ClientStop = { type: "client.stop", sessionId, reason };
    this.sendJson(msg);
  }

  close() {
    this.closedByClient = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    try {
      this.socket?.close();
    } finally {
      this.socket = null;
      this.setState("closed");
    }
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const attempt = this.reconnectAttempt++;
    const delayMs = Math.min(5000, 250 * 2 ** attempt);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closedByClient) return;
      this.connect();
    }, delayMs);
  }

  private setState(next: WsClientState) {
    this.state = next;
    this.onState?.(next);
  }
}

