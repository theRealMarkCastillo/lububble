import { useEffect, useState } from "react";
import { api } from "./api";

export function PreviewPane({
  projectId,
  devPort,
  refreshKey,
  busy,
  onManualRestart,
}: {
  projectId: string;
  devPort: number | null;
  refreshKey: number;
  busy: boolean;
  onManualRestart?: () => void;
}) {
  const [restarting, setRestarting] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {}, [refreshKey]);

  async function hardRestart() {
    setRestarting(true);
    try {
      await api.devRestart(projectId);
      setNonce((n) => n + 1);
      onManualRestart?.();
    } finally {
      setRestarting(false);
    }
  }

  return (
    <div className="preview-pane">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "#8b8b95" }}>preview · :{devPort ?? "…"}</span>
        <button
          onClick={() => {
            setNonce((n) => n + 1);
          }}
        >
          ↻ Refresh
        </button>
        <button onClick={() => void hardRestart()} disabled={busy || restarting}>
          {restarting ? "Restarting…" : "⟳ Restart stack"}
        </button>
        <a href={`http://localhost:${devPort ?? 0}/`} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
          <button disabled={devPort === null}>↗ Open in new tab</button>
        </a>
        {busy && <span style={{ position: "relative", fontSize: 12, color: "#9a9aa6" }}>agent working…</span>}
      </div>
      {devPort !== null ? (
        <iframe key={`${refreshKey}-${nonce}`} src={`http://localhost:${devPort}/`} title="preview" />
      ) : (
        <div style={{ color: "#767684", fontSize: 13 }}>Loading ports…</div>
      )}
    </div>
  );
}
