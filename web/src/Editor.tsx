import { useCallback, useEffect, useState } from "react";
import { api, type AgentEvent, type HistoryEntry } from "./api";
import { ChatPanel } from "./ChatPanel";
import { PreviewPane } from "./PreviewPane";
import { CodePane } from "./CodePane";
import { LogsPane } from "./LogsPane";
import { MorePane } from "./MorePane";
import { chunkText, planMarker, type ChatLine } from "./types";

type Tab = "preview" | "code" | "logs" | "more";export function Editor({ projectId }: { projectId: string }) {
  const [tab, setTab] = useState<Tab>("preview");
  const [devPort, setDevPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [announce, setAnnounce] = useState("");

  const refreshHistory = useCallback(async () => {
    try {
      setHistory((await api.history(projectId)).history);
    } catch {
      setHistory([]);
    }
  }, [projectId]);

  useEffect(() => {
    api.ports(projectId).then((r) => setDevPort(r.ports.dev)).catch(() => {});
    void refreshHistory();
    api
      .chat(projectId)
      .then((r) => setLines((r.lines as ChatLine[]).filter((l) => l && typeof l.text === "string")))
      .catch(() => {});
  }, [projectId, refreshHistory]);

  const addLine = useCallback((line: ChatLine, append: boolean) => {
    setLines((prev) => {
      const last = prev[prev.length - 1];
      if (append && line.kind === last?.kind && (line.kind === "a" || line.kind === "t")) {
        return [...prev.slice(0, -1), { kind: line.kind, text: last.text + line.text }];
      }
      return [...prev, line];
    });
  }, []);

  function handleEvent(e: AgentEvent) {
    if (e.kind !== "update") return;
    const payload = e.payload as { method?: string; params?: Record<string, unknown> };
    if (payload?.method !== "session/update") return;
    const update = (payload.params as { update?: Record<string, unknown> }).update;
    if (!update) return;
    if (update.sessionUpdate === "agent_message_chunk") {
      const text = chunkText(update.content);
      if (text) addLine({ kind: "a", text }, true);
      return;
    }
    if (update.sessionUpdate === "agent_thought_chunk") {
      const text = chunkText(update.content);
      if (text) addLine({ kind: "t", text }, true);
      return;
    }
    if (update.sessionUpdate === "tool_call") {
      const call = update as { title?: string; status?: string; kind?: string };
      addLine({ kind: "tc", text: `▸ ${call.title ?? "tool"}${call.status ? ` · ${call.status}` : ""}` }, false);
      return;
    }
    if (update.sessionUpdate === "plan") {
      const plan = update as { entries?: { content?: string; status?: string }[] };
      for (const entry of plan.entries ?? []) {
        addLine({ kind: "sys", text: `${planMarker(entry.status ?? "")} ${entry.content ?? ""}` }, false);
      }
    }
  }

  async function send(prompt: string, attachments: { name: string }[] = []) {
    if (busy || !prompt.trim()) return;
    addLine({ kind: "u", text: prompt }, false);
    setBusy(true);
    let streamed = false;
    const trackChunks = (e: AgentEvent) => {
      handleEvent(e);
      const payload = e.payload as { method?: string; params?: Record<string, unknown> };
      if (
        payload?.method === "session/update" &&
        (payload.params as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "agent_message_chunk"
      ) {
        streamed = true;
      }
    };
    try {
      const result = await api.promptStream(projectId, prompt, attachments, trackChunks);
      addLine({ kind: "sys", text: `${result.ok ? "done" : "ended"} · ${result.attempts} iteration(s)` }, false);
      if (!streamed && result.reply?.trim()) addLine({ kind: "a", text: result.reply }, false);
    } catch (e) {
      addLine({ kind: "err", text: `error: ${(e as Error).message}` }, false);
    } finally {
      setBusy(false);
      setRefreshKey((k) => k + 1);
      void refreshHistory();
    }
  }

  async function restore(hash: string) {
    setBusy(true);
    try {
      await api.restore(projectId, hash);
      setAnnounce(`restored ${hash}`);
      setRefreshKey((k) => k + 1);
      await refreshHistory();
    } catch (e) {
      setAnnounce((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      const result = await api.publish(projectId);
      setAnnounce(result.ok ? `published → ${result.url}` : `publish failed:\n${result.output}`);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setAnnounce((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <div className="topbar">
        <a href="#/" style={{ color: "#8b8b95", textDecoration: "none", fontSize: 13 }}>
          ← Projects
        </a>
        <h1>{projectId}</h1>
        {devPort !== null && <span style={{ fontSize: 12, color: "#8b8b95" }}>dev :{devPort}</span>}
        <div className="spacer" />
        {announce && <span style={{ fontSize: 12, color: "#8de08d", whiteSpace: "pre" }}>{announce}</span>}
        <HistoryButton history={history} onRestore={(h) => void restore(h)} disabled={busy} />
        <button className="primary" disabled={busy} onClick={() => void publish()}>
          Publish
        </button>
      </div>
      <div className="editor">
        <ChatPanel projectId={projectId} lines={lines} addLine={addLine} onSend={(p, atts) => void send(p, atts)} busy={busy} />
        <div className="main">
          <div className="tabs">
            {(["preview", "code", "logs", "more"] as Tab[]).map((t) => (
              <button key={t} className={t === tab ? "set" : ""} onClick={() => setTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {tab === "preview" && <PreviewPane projectId={projectId} devPort={devPort} refreshKey={refreshKey} busy={busy} onManualRestart={() => void refreshHistory()} />}
          {tab === "code" && <CodePane projectId={projectId} />}
          {tab === "logs" && <LogsPane projectId={projectId} />}
          {tab === "more" && <MorePane projectId={projectId} onChanged={() => void refreshHistory()} />}
        </div>
      </div>
    </div>
  );
}

function HistoryButton({
  history,
  onRestore,
  disabled,
}: {
  history: HistoryEntry[];
  onRestore: (hash: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span style={{ position: "relative" }}>
      <button onClick={() => setOpen(!open)}>History</button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: 34,
            zIndex: 10,
            background: "#17171a",
            border: "1px solid #333",
            borderRadius: 8,
            padding: 8,
            width: 460,
            maxHeight: 380,
            overflowY: "auto",
          }}
        >
          {history.length === 0 && <div style={{ fontSize: 12, color: "#8b8b95" }}>No snapshots yet — send a prompt.</div>}
          <ul style={{ padding: 0, margin: 0 }} className="history">
            {history.map((h) => (
              <li key={h.hash} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ color: "#9db4ff" }}>{h.hash}</code>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.message}</span>
                <button onClick={() => onRestore(h.hash)} disabled={disabled}>
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </span>
  );
}
