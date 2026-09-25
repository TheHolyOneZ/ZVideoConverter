import { Component, type ErrorInfo, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ui] crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const de = navigator.language.toLowerCase().startsWith("de");
    return (
      <div style={{ height: "100vh", display: "grid", placeItems: "center", background: "var(--bg, #111)", color: "var(--text, #eee)", fontFamily: "system-ui, sans-serif", padding: 24 }}>
        <div style={{ maxWidth: 520 }}>
          <h1 style={{ fontSize: 20, margin: "0 0 8px" }}>{de ? "Da ist etwas schiefgelaufen." : "Something went wrong."}</h1>
          <p style={{ margin: "0 0 16px", opacity: 0.75, fontSize: 14, lineHeight: 1.5 }}>
            {de
              ? "Die Oberfläche ist abgestürzt. Deine Warteschlange und Profile sind gespeichert, nach dem Neuladen ist alles wieder da."
              : "The window crashed. Your queue and profiles are saved; everything is back after a reload."}
          </p>
          <pre style={{ fontSize: 12, padding: 12, borderRadius: 6, background: "rgba(127,127,127,.12)", whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto" }}>{String(error.stack || error)}</pre>
          <button type="button" onClick={() => location.reload()} style={{ marginTop: 14, padding: "8px 16px", borderRadius: 6, border: 0, background: "#FF5B2E", color: "#1A0803", fontWeight: 600, cursor: "pointer" }}>
            {de ? "Neu laden" : "Reload"}
          </button>
        </div>
      </div>
    );
  }
}
