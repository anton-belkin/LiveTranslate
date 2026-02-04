import type { ReactNode } from "react";
import { Component } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={{ padding: 16, fontFamily: "system-ui, sans-serif" }}>
        <h2 style={{ margin: 0 }}>LiveTranslate crashed</h2>
        <p style={{ opacity: 0.8 }}>
          Open DevTools Console for details. Error message:
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 8,
            padding: 12,
            background: "rgba(0,0,0,0.04)",
          }}
        >
          {this.state.error.message}
        </pre>
      </div>
    );
  }
}

