import { app, BrowserWindow, session } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

import { registerIpcHandlers } from "./ipc/registerIpc.js";
import { ServerManager } from "./server/serverManager.js";
import { state } from "./state.js";
import { KeyStore } from "./keys/keyStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = !app.isPackaged;
let serverManager: ServerManager | null = null;

function debugLog(message: string, data: Record<string, unknown> = {}, hypothesisId = "A", runId = "pre-fix") {
  // #region agent log
  fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      runId,
      hypothesisId,
      location: "apps/desktop/src/main.ts",
      message,
      data,
      timestamp: Date.now()
    })
  }).catch(() => {});
  // #endregion
}

function getPreloadPath() {
  // Use a CommonJS preload so it loads reliably in packaged builds.
  // - Packaged: included at `app.asar/preload.cjs`
  // - Dev: file sits at `apps/desktop/preload.cjs`
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "preload.cjs")
    : path.resolve(__dirname, "../preload.cjs");
}

function getDevRendererUrl() {
  return process.env.ELECTRON_RENDERER_URL?.trim() || "http://localhost:5173";
}

function getProdIndexHtmlPath() {
  // In production we load the Vite build output that is packaged alongside the app.
  // When packaged, `process.resourcesPath` is the correct base for extraResources.
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "app-resources", "web", "dist", "index.html")
    : path.resolve(__dirname, "../../web/dist/index.html");
}

async function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  debugLog(
    "window created",
    { isDev, isPackaged: app.isPackaged, preloadPath: getPreloadPath() },
    "A",
  );

  win.webContents.on("did-fail-load", (_ev, errorCode, errorDescription, validatedURL) => {
    debugLog(
      "did-fail-load",
      { errorCode, errorDescription, validatedURL },
      "A",
    );
  });
  win.webContents.on("did-finish-load", () => {
    debugLog("did-finish-load", { url: win.webContents.getURL() }, "A");
  });
  win.webContents.on("console-message", (_ev, level, message, line, sourceId) => {
    // Avoid log spam: keep only errors/warnings.
    if (level <= 2) return;
    debugLog("renderer console-message", { level, message, line, sourceId }, "B");
  });

  if (isDev) {
    const url = getDevRendererUrl();
    debugLog("loadURL (dev)", { url }, "A");
    await win.loadURL(url);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    const p = getProdIndexHtmlPath();
    debugLog("loadFile (prod)", { path: p, existsSync: fs.existsSync(p) }, "A");
    await win.loadFile(p);
  }

  return win;
}

function configurePermissions() {
  // Keep this minimal: allow media permissions for our app origins, let macOS/Windows prompt.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback, details) => {
    const url = details.requestingUrl || "";
    const isLocal =
      url.startsWith("http://localhost:") ||
      url.startsWith("http://127.0.0.1:") ||
      url.startsWith("file://");

    if (!isLocal) return callback(false);

    if (permission === "media" || permission === "display-capture") return callback(true);
    return callback(false);
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  try {
    serverManager?.stop();
  } catch {
    // ignore
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
});

void (async () => {
  await app.whenReady();
  debugLog(
    "app.whenReady",
    {
      isDev,
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      __dirname
    },
    "A",
  );
  configurePermissions();
  serverManager = new ServerManager({ host: "127.0.0.1", port: 8787 });
  const keyStore = new KeyStore();

  // Load persisted keys from OS credential store (Keychain/Credential Manager).
  try {
    state.keys = await keyStore.load();
  } catch {
    // If keytar isn't available, we'll fall back to in-memory keys for this run.
  }

  registerIpcHandlers({ server: serverManager, keyStore });

  // Best-effort: if keys are already available (later tasks will load from keychain),
  // start the server on launch. If not, the UI can still load and prompt the user.
  if (state.keys.azureSpeechKey && state.keys.azureSpeechRegion && state.keys.groqApiKey) {
    try {
      await serverManager.start({
        AZURE_SPEECH_KEY: state.keys.azureSpeechKey,
        AZURE_SPEECH_REGION: state.keys.azureSpeechRegion,
        AZURE_SPEECH_ENDPOINT: state.keys.azureSpeechEndpoint,
        GROQ_API_KEY: state.keys.groqApiKey
      });
    } catch {
      // ServerManager logs details; UI will show connection errors.
    }
  }

  await createMainWindow();
})();

