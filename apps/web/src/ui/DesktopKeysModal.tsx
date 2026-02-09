import { useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
};

function hasDesktopBridge() {
  return typeof window !== "undefined" && typeof window.livetranslateDesktop === "object";
}

export function DesktopKeysModal({ open, onClose }: Props) {
  const desktop = hasDesktopBridge() ? window.livetranslateDesktop : undefined;

  const [azureSpeechKey, setAzureSpeechKey] = useState("");
  const [azureSpeechRegion, setAzureSpeechRegion] = useState("");
  const [azureSpeechEndpoint, setAzureSpeechEndpoint] = useState("");
  const [groqApiKey, setGroqApiKey] = useState("");

  const [status, setStatus] = useState<LiveTranslateApiKeysStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const canUse = useMemo(() => Boolean(desktop), [desktop]);

  useEffect(() => {
    if (!open) return;
    if (!desktop) return;
    setError(null);
    setSavedAt(null);
    void desktop
      .getApiKeysStatus()
      .then((s) => setStatus(s))
      .catch((e) => setError(String(e)));
  }, [open, desktop]);

  if (!open) return null;

  return (
    <div
      className="modalOverlay"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div className="modalPanel card" role="dialog" aria-modal="true" aria-label="API keys">
        <div className="modalHeader">
          <div>
            <div className="modalTitle">API keys (stored on this machine)</div>
            <div className="modalSub">
              Keys are stored in the OS credential store. They are never sent to the browser.
            </div>
          </div>
          <button className="btn btnSmall" onClick={onClose}>
            Close
          </button>
        </div>

        {!canUse ? (
          <div className="pill">Desktop integration not available (run inside the Electron app).</div>
        ) : null}

        {status ? (
          <div className="pill">
            Azure: {status.hasAzureSpeechKey && status.hasAzureSpeechRegion ? "set" : "missing"} ·
            Groq: {status.hasGroqApiKey ? "set" : "missing"}
          </div>
        ) : null}

        <div className="modalGrid">
          <label className="fieldLabel">
            <span>Azure Speech key</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={azureSpeechKey}
              onChange={(e) => setAzureSpeechKey(e.target.value)}
              placeholder="AZURE_SPEECH_KEY"
            />
          </label>
          <label className="fieldLabel">
            <span>Azure Speech region</span>
            <input
              className="input"
              autoComplete="off"
              value={azureSpeechRegion}
              onChange={(e) => setAzureSpeechRegion(e.target.value)}
              placeholder="e.g. eastus"
            />
          </label>
          <label className="fieldLabel">
            <span>Azure endpoint (optional)</span>
            <input
              className="input"
              autoComplete="off"
              value={azureSpeechEndpoint}
              onChange={(e) => setAzureSpeechEndpoint(e.target.value)}
              placeholder="AZURE_SPEECH_ENDPOINT"
            />
          </label>
          <label className="fieldLabel">
            <span>Groq API key</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={groqApiKey}
              onChange={(e) => setGroqApiKey(e.target.value)}
              placeholder="GROQ_API_KEY"
            />
          </label>
        </div>

        {error ? <div className="pill modalError">{error}</div> : null}
        {savedAt ? <div className="pill">Saved. Backend restarted.</div> : null}

        <div className="modalFooter">
          {desktop ? (
            <>
              <button
                className="btn btnSmall"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setSavedAt(null);
                  try {
                    const next = await desktop.importKeysFile();
                    setStatus(next);
                    setSavedAt(Date.now());
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Import file
              </button>
              <button
                className="btn btnSmall"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  setSavedAt(null);
                  try {
                    await desktop.exportKeysFile();
                    setSavedAt(Date.now());
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Export file
              </button>
            </>
          ) : null}
          <div className="modalSpacer" />
          <button
            className="btn btnPrimary"
            disabled={!desktop || busy}
            onClick={async () => {
              if (!desktop) return;
              setBusy(true);
              setError(null);
              setSavedAt(null);
              try {
                const next = await desktop.setApiKeys({
                  azureSpeechKey,
                  azureSpeechRegion,
                  azureSpeechEndpoint: azureSpeechEndpoint.trim() || undefined,
                  groqApiKey
                });
                setStatus(next);
                setSavedAt(Date.now());
              } catch (e) {
                setError(String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving..." : "Save keys"}
          </button>
        </div>

        <div className="modalSub" style={{ marginTop: 10 }}>
          Optional keys file export is intended to reduce accidental leakage (it is encrypted using a
          key embedded in this app version). Treat exported files as sensitive, and note they may
          stop importing across app versions.
        </div>
      </div>
    </div>
  );
}

