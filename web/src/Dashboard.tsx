import { useEffect, useState } from "react";
import { api, type ProjectRecord, type Ports } from "./api";

export function Dashboard() {
  const [projects, setProjects] = useState<ProjectRecord[] | null>(null);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("next-lite");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = () => api.listProjects().then((r) => setProjects(r.projects));

  useEffect(() => {
    void refresh();
  }, []);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api.createProject(name, template);
      setName("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    try {
      await api.deleteProject(id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <h1>Lububble 🫧</h1>
        <span style={{ fontSize: 12, color: "#8b8b95" }}>local-first app builder</span>
      </div>
      <div className="dashboard">
        <h2>Your apps</h2>
        <div className="new-project">
          <select
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
            style={{ width: 200 }}
          >
            <option value="next-lite">lite (SQLite-free, no DB)</option>
            <option value="next-postgres">postgres (default full)</option>
          </select>
          <input
            placeholder="Name your app, e.g. Habit Tracker"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && create()}
            autoFocus
          />
          <button className="primary" onClick={() => void create()} disabled={busy || !name.trim()}>
            New project
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {projects?.length === 0 && <p style={{ color: "#767684", fontSize: 13 }}>No projects yet. Create your first one above.</p>}
        {projects?.map((p) => (
          <ProjectRow key={p.id} id={p.id} name={p.name} createdAt={p.createdAt} onRemove={() => void remove(p.id)} disabled={busy} />
        ))}
      </div>
    </div>
  );
}

function ProjectRow({
  id,
  name,
  onRemove,
  disabled,
}: {
  id: string;
  name: string;
  createdAt: string;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [ports, setPorts] = useState<Ports | null>(null);
  useEffect(() => {
    api.ports(id).then((r) => setPorts(r.ports)).catch(() => {});
  }, [id]);

  return (
    <div className="project-card">
      <div>
        <div>{name}</div>
        <div style={{ fontSize: 11, color: "#77777f" }}>
          id: {id}
          {ports && ` · dev :${ports.dev} · prod :${ports.prod}`}
        </div>
      </div>
      <div>
        <a href={`#/p/${id}`} style={{ textDecoration: "none" }}>
          <button className="primary">Open editor</button>
        </a>
        <button onClick={onRemove} disabled={disabled}>
          Delete
        </button>
      </div>
    </div>
  );
}
