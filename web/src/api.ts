export interface ProjectRecord {
  id: string;
  name: string;
  createdAt: string;
}

export interface Ports {
  dev: number;
  prod: number;
  staging: number;
}

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface Config {
  providers: Provider[];
  defaultProviderId: string | null;
}

export interface HistoryEntry {
  hash: string;
  message: string;
  date: string;
}

export interface AgentEvent {
  kind: "update" | "stderr" | "iteration";
  attempt: number;
  payload: unknown;
}

export interface AgentDone {
  ok: boolean;
  reply: string;
  attempts: number;
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

function post(body: unknown): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

function put(body: unknown): RequestInit {
  return { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

export const api = {
  listProjects: () => fetch("/api/projects").then((r) => j<{ projects: ProjectRecord[] }>(r)),

  createProject: (name: string, template = "next-lite") =>
    fetch("/api/projects", post({ name, template })).then((r) => j<{ project: ProjectRecord; ports: Ports }>(r)),

  deleteProject: (id: string) =>
    fetch(`/api/projects/${id}`, { method: "DELETE" }).then((r) => j<{ ok: boolean }>(r)),

  ports: (id: string) => fetch(`/api/projects/${id}/ports`).then((r) => j<{ ports: Ports }>(r)),

  files: (id: string) => fetch(`/api/projects/${id}/files`).then((r) => j<{ files: string[] }>(r)),

  readFile: (id: string, path: string) =>
    fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`).then((r) => (r.ok ? r.text() : "")),

  writeFile: (id: string, path: string, content: string) =>
    fetch(`/api/projects/${id}/file?path=${encodeURIComponent(path)}`, put({ content })).then((r) => j<{ ok: boolean }>(r)),

  history: (id: string) => fetch(`/api/projects/${id}/history`).then((r) => j<{ history: HistoryEntry[] }>(r)),

  restore: (id: string, hash: string) =>
    fetch(`/api/projects/${id}/history/${hash}/restore`, { method: "POST" }).then((r) => j<{ ok: boolean; detail: string }>(r)),

  logs: (id: string) => fetch(`/api/projects/${id}/logs`).then((r) => r.text()),

  getConfig: () => fetch("/api/config").then((r) => j<{ config: Config }>(r)),

  saveConfig: (config: Config) => fetch("/api/config", post({ config })).then((r) => j<{ config: Config }>(r)),

  publish: (id: string) =>
    fetch(`/api/projects/${id}/publish`, { method: "POST" }).then((r) =>
      j<{ ok: boolean; url: string; output: string; verified?: boolean; httpStatus?: number; port?: number }>(r),
    ),

  chat: (id: string) => fetch(`/api/projects/${id}/chat`).then((r) => j<{ lines: { kind: string; text: string }[] }>(r)),

  uploadsUrl: (id: string, name: string) => `/api/projects/${id}/uploads/${encodeURIComponent(name)}`,

  async upload(id: string, file: File): Promise<{ name: string; path: string; isImage: boolean; mimeType?: string }> {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`/api/projects/${id}/upload`, { method: "POST", body: form });
    return j<{ name: string; path: string; isImage: boolean; mimeType?: string }>(r);
  },

  devRestart: (id: string) =>
    fetch(`/api/projects/${id}/dev/restart`, { method: "POST" }).then((r) =>
      j<{ ok: boolean; output: string }>(r),
    ),

  publishStop: (id: string) =>
    fetch(`/api/projects/${id}/publish/stop`, { method: "POST" }).then((r) => j<{ ok: boolean; output: string }>(r)),

  async promptStream(
    id: string,
    prompt: string,
    attachments: { name: string }[],
    onEvent: (e: AgentEvent) => void,
  ): Promise<AgentDone> {
    const response = await fetch(`/api/projects/${id}/prompt/stream`, post({ prompt, attachments }));
    if (!response.ok || !response.body) throw new Error(`prompt stream failed (${response.status})`);
    if (!response.ok || !response.body) throw new Error(`prompt stream failed (${response.status})`);
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) throw new Error("stream ended without a result");
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const nl = buffer.indexOf("\n\n");
        if (nl === -1) break;
        const raw = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 2);
        let event = "";
        let data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event: ")) event = line.slice(7);
          else if (line.startsWith("data: ")) data += line.slice(6);
        }
        if (!data) continue;
        const parsed = JSON.parse(data) as Record<string, unknown>;
        if (event === "agent") onEvent(parsed as unknown as AgentEvent);
        if (event === "done") return parsed as unknown as AgentDone;
        if (event === "error") throw new Error((parsed as { message?: string }).message ?? "agent error");
      }
    }
  },
};
