import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const tsc = spawn(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["-C", root, "build", "--watch"],
  { stdio: "inherit" },
);

let electronProc = null;
let started = false;

function startElectron() {
  if (started) return;
  started = true;
  electronProc = spawn(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["-C", root, "start"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        ELECTRON_RENDERER_URL: process.env.ELECTRON_RENDERER_URL || "http://localhost:5173",
      },
    },
  );
}

// Naive delay so the first `tsc` emit happens before Electron starts.
setTimeout(startElectron, 1500);

function shutdown(code = 0) {
  try {
    tsc.kill();
  } catch {}
  try {
    electronProc?.kill();
  } catch {}
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("exit", () => shutdown(0));

