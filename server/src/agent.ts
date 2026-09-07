import { AcpProcess, type AcpSessionUpdate } from "./acp.js";
import { loadConfig } from "./config.js";
import { listProjects, projectDir } from "./projects.js";
import { run } from "./docker.js";
import { snapshot } from "./snapshots.js";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG_DIR } from "./paths.js";

const MAX_ITERATIONS = 3;
const PROMPT_TIMEOUT_MS = 15 * 60_000;

export interface AgentEvent {
  kind: "update" | "stderr" | "iteration";
  attempt: number;
  payload: unknown;
}

export interface AgentRunResult {
  ok: boolean;
  reply: string;
  attempts: number;
}

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const MCP_MAIN = path.resolve(thisDir, "..", "..", "mcp-tools", "dist", "main.js");

async function ensureMcpBuild(): Promise<void> {
  try {
    await fs.access(MCP_MAIN);
    return;
  } catch {
    const build = await run("npm", ["run", "build", "-w", "@lububble/mcp-tools"], {
      cwd: path.resolve(thisDir, "..", ".."),
      timeoutMs: 120_000,
    });
    if (build.code !== 0) throw new Error(`mcp-tools build failed: ${build.text.slice(-2000)}`);
  }
}

export async function writeHermesHome(): Promise<string | null> {
  const config = await loadConfig();
  const provider =
    config.providers.find((p) => p.id === config.defaultProviderId) ?? config.providers[0] ?? null;
  if (!provider) return null;

  const home = path.join(CONFIG_DIR, "hermes-home");
  await fs.mkdir(home, { recursive: true });
  const yaml = [
    "model:",
    `  default: ${provider.model}`,
    "  provider: custom",
    `  base_url: ${provider.baseUrl}`,
    "providers:",
    "  custom:",
    `    base_url: ${provider.baseUrl}`,
    `    api_key: ${provider.apiKey}`,
    "",
  ].join("\n");
  await fs.writeFile(path.join(home, "config.yaml"), yaml, { mode: 0o600 });
  return home;
}

export async function runAgent(
  projectId: string,
  text: string,
  onUpdate?: (event: AgentEvent) => void,
): Promise<AgentRunResult> {
  if (!(await listProjects()).some((p) => p.id === projectId)) {
    throw new Error(`unknown project: ${projectId}`);
  }
  const dir = await projectDir(projectId);
  await ensureMcpBuild();
  const home = await writeHermesHome();

  const proc = new AcpProcess(
    {
      command: process.env.LUBUBBLE_HERMES_BIN ?? "hermes",
      args: ["acp", "--accept-hooks"],
      env: home ? { HERMES_HOME: home } : {},
      cwd: dir,
    },
    (chunk) => onUpdate?.({ kind: "stderr", attempt: 0, payload: chunk }),
  );

  try {
    await proc.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "lububble", version: "0.1.0" },
    });

    const session = (await proc.request("session/new", {
      cwd: dir,
      mcpServers: [
        {
          name: "lububble-tools",
          type: "stdio",
          command: process.execPath,
          args: [MCP_MAIN],
          env: [{ name: "LUBUBBLE_WORKSPACE_ROOT", value: dir }],
        },
      ],
    })) as { sessionId: string };

    let attempt = 1;
    let current = text;
    let reply = "";
    let lastError: Error | null = null;
    while (attempt <= MAX_ITERATIONS) {
      const collected: AcpSessionUpdate[] = [];
      const listener = (u: AcpSessionUpdate) => {
        collected.push(u);
        onUpdate?.({ kind: "update", attempt, payload: u });
      };
      proc.updates.on("update", listener);
      let thrown: Error = new Error("agent ended turn without completion");
      try {
        const result = (await proc.request(
          "session/prompt",
          { sessionId: session.sessionId, prompt: [{ type: "text", text: current }] },
          PROMPT_TIMEOUT_MS,
        )) as { stopReason?: string };
        reply = extractText(collected);
        const snapshotMessage = `iteration ${attempt}: ${text.slice(0, 120)}`;
        const snap = await snapshot(dir, snapshotMessage);
        onUpdate?.({ kind: "iteration", attempt, payload: { snapshot: snap.detail } });
        if (result?.stopReason === "end_turn") {
          return { ok: true, reply, attempts: attempt };
        }
        if (result?.stopReason === "refusal" || result?.stopReason === "cancelled") {
          return { ok: false, reply, attempts: attempt };
        }
      } catch (e) {
        thrown = e as Error;
      } finally {
        proc.updates.removeListener("update", listener);
      }
      lastError = thrown;
      if (attempt >= MAX_ITERATIONS) break;
      attempt += 1;
      current = `Previous attempt failed or ended without fulfilling the task. Error: ${lastError.message}. Continue working as instructed until the task is verified complete, then finish.`;
      onUpdate?.({ kind: "iteration", attempt, payload: { error: lastError.message } });
    }
    return { ok: false, reply, attempts: attempt };
  } finally {
    proc.kill();
  }
}

export function extractText(
  updates: { method: string; params: Record<string, unknown> }[],
): string {
  const parts: string[] = [];
  for (const u of updates) {
    if (u.method !== "session/update") continue;
    const wrapper = u.params as { update?: Record<string, unknown> };
    const p = (wrapper?.update ?? (u.params as { sessionUpdate?: string })) as {
      sessionUpdate?: string;
      content?: unknown;
    };
    if (p?.sessionUpdate !== "agent_message_chunk") continue;
    const c = p.content;
    if (Array.isArray(c)) {
      for (const piece of c as unknown as { text?: string }[]) {
        if (piece?.text) parts.push(piece.text);
      }
    } else if (c && typeof c === "object") {
      const t = (c as { text?: unknown }).text;
      if (typeof t === "string") parts.push(t);
    }
  }
  return parts.join("");
}
