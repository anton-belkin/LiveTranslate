import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./ui/App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import "./ui/styles.css";

// #region agent log
fetch("http://127.0.0.1:7242/ingest/8fd36b07-294f-4ce9-ac11-4c200acb96eb", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    runId: "pre-fix",
    hypothesisId: "D",
    location: "apps/web/src/main.tsx",
    message: "renderer entrypoint reached",
    data: { href: window.location.href },
    timestamp: Date.now()
  })
}).catch(() => {});
// #endregion

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);

