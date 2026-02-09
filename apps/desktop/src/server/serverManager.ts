import { app } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type ServerKeysEnv = {
  AZURE_SPEECH_KEY?: string;
  AZURE_SPEECH_REGION?: string;
  AZURE_SPEECH_ENDPOINT?: string;
  GROQ_API_KEY?: string;
};

type ServerStatus = "stopped" | "starting" | "running" | "error";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function pnpmCmd() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function waitForPortOpen(args: { host: string; port: number; timeoutMs: number }) {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const tick = () => {
      const socket = net.connect({ host: args.host, port: args.port });
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= args.timeoutMs) {
          reject(new Error(`Server did not open port ${args.host}:${args.port} in time.`));
          return;
        }
        setTimeout(tick, 150);
      });
    };
    tick();
  });
}

function resolveServerRoot() {
  if (app.isPackaged) {
    // Packaged into `app.asar/app-resources/server` by `prepare:resources`.
    return path.join(process.resourcesPath, "app.asar", "app-resources", "server");
  }
  // apps/desktop/dist/server -> apps/server
  return path.resolve(__dirname, "../../../server");
}

function hasBuiltServer(serverRoot: string) {
  return fs.existsSync(path.join(serverRoot, "dist", "index.js"));
}

export class ServerManager {
  private status: ServerStatus = "stopped";
  private proc: ChildProcessWithoutNullStreams | null = null;
  private readonly port: number;
  private readonly host: string;
  private logBuffer: string[] = [];

  constructor(args?: { host?: string; port?: number }) {
    this.host = args?.host ?? "127.0.0.1";
    this.port = args?.port ?? 8787;
  }

  getStatus() {
    return this.status;
  }

  getWsUrl() {
    return `ws://${this.host}:${this.port}`;
  }

  getRecentLogs() {
    return this.logBuffer.slice();
  }

  async start(envKeys: ServerKeysEnv) {
    if (this.proc || this.status === "starting" || this.status === "running") return;

    this.status = "starting";
    const serverRoot = resolveServerRoot();

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...envKeys,
      PORT: String(this.port),
      // Run the Electron binary as a Node process when spawning the built server.
      ELECTRON_RUN_AS_NODE: "1"
    };

    const built = hasBuiltServer(serverRoot);
    const child = built
      ? spawn(process.execPath, [path.join(serverRoot, "dist", "index.js")], {
          cwd: serverRoot,
          env,
          stdio: "pipe"
        })
      : spawn(pnpmCmd(), ["-C", serverRoot, "dev"], {
          cwd: serverRoot,
          env,
          stdio: "pipe"
        });

    this.proc = child;
    this.attachLogs(child);

    child.once("exit", (code, signal) => {
      this.appendLogLine(`[server] exited code=${code} signal=${signal ?? "null"}`);
      this.proc = null;
      this.status = code === 0 ? "stopped" : "error";
    });

    try {
      await waitForPortOpen({ host: this.host, port: this.port, timeoutMs: 6000 });
      this.status = "running";
      this.appendLogLine(`[server] ready ws=${this.getWsUrl()}`);
    } catch (err) {
      this.appendLogLine(`[server] failed to start: ${String(err)}`);
      this.status = "error";
      // Best-effort cleanup.
      this.stop();
      throw err;
    }
  }

  stop() {
    const child = this.proc;
    this.proc = null;
    if (!child) {
      this.status = "stopped";
      return;
    }
    this.status = "stopped";
    try {
      child.kill();
    } catch {
      // ignore
    }
  }

  async restart(envKeys: ServerKeysEnv) {
    this.stop();
    await this.start(envKeys);
  }

  private attachLogs(child: ChildProcessWithoutNullStreams) {
    const onChunk = (buf: Buffer) => {
      const text = buf.toString("utf8");
      for (const line of text.split(/\r?\n/g)) {
        if (!line) continue;
        this.appendLogLine(`[server] ${line}`);
      }
    };
    child.stdout.on("data", onChunk);
    child.stderr.on("data", onChunk);
  }

  private appendLogLine(line: string) {
    this.logBuffer.push(line);
    if (this.logBuffer.length > 400) this.logBuffer.splice(0, this.logBuffer.length - 400);
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

