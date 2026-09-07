import { useState } from "react";
import { api } from "./api";

export function MorePane({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);

  async function publish() {
    setPublishing(true);
    setStatus("building and publishing prod stack…");
    try {
      const result = await api.publish(projectId);
      setStatus(result.ok ? `[OK] ${result.url}\n${result.output.slice(-600)}` : `publish failed\n${result.output}`);
      onChanged();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  async function stopProd() {
    setPublishing(true);
    try {
      await api.publishStop(projectId);
      setStatus("prod stack stopped");
      onChanged();
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="morepane">
      <section>
        <h3>Publish (prod docker compose)</h3>
        <button className="primary" onClick={() => void publish()} disabled={publishing}>
          {publishing ? "Working…" : "Build & run prod stack"}
        </button>{" "}
        <button onClick={() => void stopProd()} disabled={publishing}>
          Stop prod
        </button>
        <div className="publish-status" style={{ whiteSpace: "pre" }}>
          {status}
        </div>
        <p style={{ fontSize: 12, color: "#8b8b95" }}>
          Publish runs docker-compose.prod.yml as its own compose project on the prod port and persists until stopped.
        </p>
      </section>

          </div>
  );
}
