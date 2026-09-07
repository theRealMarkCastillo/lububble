import { useEffect, useState } from "react";
import { api } from "./api";

export function CodePane({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .files(projectId)
      .then((r) => setFiles(r.files))
      .catch((e) => setError((e as Error).message));
  }, [projectId]);

  useEffect(() => {
    if (!selected) return;
    setContent("");
    setDirty(false);
    api
      .readFile(projectId, selected)
      .then(setContent)
      .catch((e) => setError((e as Error).message));
  }, [projectId, selected]);

  async function save() {
    if (!selected) return;
    try {
      await api.writeFile(projectId, selected, content);
      setDirty(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="code-pane">
      <div className="filetree">
        {(files ?? []).map((f) => (
          <div key={f} className={f === selected ? "sel" : ""} onClick={() => setSelected(f)}>
            {f}
          </div>
        ))}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {selected && (
          <div style={{ padding: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <code style={{ fontSize: 12, color: "#9db4ff" }}>{selected}</code>
            <button className="primary" disabled={!dirty} onClick={() => void save()}>
              {dirty ? "Save" : "Saved"}
            </button>
            {error && <span className="error">{error}</span>}
          </div>
        )}
        {selected ? (
          <textarea
            style={{ flex: 1, fontFamily: "ui-monospace, Menlo, monospace", borderRadius: 0 }}
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
          />
        ) : (
          <div className="logpane" style={{ color: "#767684" }}>
            Select a file to view and edit.
          </div>
        )}
      </div>
    </div>
  );
}
