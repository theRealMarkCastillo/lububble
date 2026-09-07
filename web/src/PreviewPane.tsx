import { useEffect } from "react";

export function PreviewPane({
  projectId,
  devPort,
  refreshKey,
  busy,
}: {
  projectId: string;
  devPort: number | null;
  refreshKey: number;
  busy: boolean;
}) {
  useEffect(() => {}, [refreshKey]);

  return (
    <div className="preview-pane">
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 12, color: "#8b8b95" }}>preview · /preview/{projectId}</span>
        {busy && <span style={{ position: "relative", fontSize: 12, color: "#9a9aa6" }}>agent working…</span>}
      </div>
      {devPort !== null ? (
        <iframe key={refreshKey} src={`/preview/${projectId}/`} title="preview" />
      ) : (
        <div style={{ color: "#767684", fontSize: 13 }}>Loading ports…</div>
      )}
    </div>
  );
}
