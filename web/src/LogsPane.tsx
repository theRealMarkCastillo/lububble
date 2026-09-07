import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

export function LogsPane({ projectId }: { projectId: string }) {
  const [logs, setLogs] = useState("loading logs…");

  const refresh = useCallback(async () => {
    try {
      setLogs(await api.logs(projectId));
    } catch (e) {
      setLogs((e as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <div className="pane">
      <div className="logpane">{logs || "no container output yet"}</div>
    </div>
  );
}
