import { AcpProcess, type AcpSessionUpdate } from "./acp.js";
import { loadConfig } from "./config.js";
import { listProjects, projectDir } from "./projects.js";
import { run } from "./docker.js";
import { snapshot } from "./snapshots.js";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG_DIR, HOME_DIR } from "./paths.js";

const MAX_ITERATIONS = 3;
const PROMPT_TIMEOUT_MS = 15 * 60_000;
const IDLE_KILL_MS = 10 * 60_000;

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

async function writeProviderOverride(home: string): Promise<void> {
  const config = await loadConfig();
  const provider =
    config.providers.find((p) => p.id === config.defaultProviderId) ?? config.providers[0] ?? null;
  if (!provider) return;
  const yaml = [
    "model:",
    `  default: ${provider.model}`,
    "  provider: custom",
    "providers:",
    "  custom:",
    `    base_url: ${provider.baseUrl}`,
    "    key_env: LUBUBBLE_API_KEY",
    "",
  ].join("\n");
  await fs.writeFile(path.join(home, "config.yaml"), yaml, { mode: 0o600 });
  await writeEnvKey(home, provider.apiKey);
}

async function writeEnvKey(home: string, key: string): Promise<void> {
  const envPath = path.join(home, ".env");
  const raw = await fs.readFile(envPath, "utf8").catch(() => "");
  const filtered = raw
    .split("\n")
    .filter((line) => !line.startsWith("LUBUBBLE_API_KEY="));
  const body = `${filtered.join("\n").replace(/\n+$/, "")}\nLUBUBBLE_API_KEY=${key}\n`;
  await fs.writeFile(envPath, body, { mode: 0o600 });
}

export async function writeHermesHome(): Promise<string | null> {
  const profileHome = path.join(HOME_DIR, ".hermes", "profiles", "lububble");
  if (!existsSync(path.join(profileHome, "config.yaml")) && !existsSync(path.join(profileHome, ".env"))) {
    const created = await run(
      process.env.LUBUBBLE_HERMES_BIN ?? "hermes",
      ["profile", "create", "lububble", "--clone", "--description", "Lububble app-builder agent: builds and runs generated apps via lububble-tools MCP."],
      { timeoutMs: 120_000 },
    );
    if (created.code !== 0 && !existsSync(path.join(profileHome, "config.yaml"))) {
      throw new Error(`failed to create the lububble hermes profile: ${created.text.slice(-1500)}`);
    }
  }
  await writeProviderOverride(profileHome);
  return profileHome;
}

interface PooledAgent {
  proc: AcpProcess;
  sessionId: string;
  cwd: string;
  resumed: boolean;
  lastUsed: number;
}

const pool = new Map<string, PooledAgent>();

const idleSweeper = setInterval(() => {
  const now = Date.now();
  for (const [projectId, agent] of pool) {
    if (now - agent.lastUsed > IDLE_KILL_MS) {
      pool.delete(projectId);
      agent.proc.exited ? null : agent.proc.kill();
    }
  }
}, 60_000);
idleSweeper.unref?.();

interface SpawnOptions {
  projectId: string;
  dir: string;
  replay: boolean;
  onUpdate?: (event: AgentEvent) => void;
}

interface SessionListInfo {
  sessionId?: string;
  session_id?: string;
  updatedAt?: string | null;
  updated_at?: string | null;
}

async function newestSessionId(proc: AcpProcess, dir: string): Promise<string | null> {
  let res: { sessions?: SessionListInfo[] } | undefined;
  try {
    res = (await proc.request("session/list", { cwd: dir }, 30_000)) as {
      sessions?: SessionListInfo[];
    };
  } catch {
    return "";
  }
  const sessions = res?.sessions?.filter((s) => s.sessionId || s.session_id) ?? [];
  if (!sessions.length) return "";
  sessions.sort((a, b) => String(b.updatedAt ?? b.updated_at ?? "").localeCompare(String(a.updatedAt ?? a.updated_at ?? "")) || 0);
  return sessions[0].sessionId ?? sessions[0].session_id ?? "";
}

async function spawnAgent(opts: SpawnOptions): Promise<PooledAgent> {
  const home = await writeHermesHome();
  const proc = new AcpProcess(
    {
      command: process.env.LUBUBBLE_HERMES_BIN ?? "hermes",
      args: ["acp", "--accept-hooks"],
      env: home ? { HERMES_HOME: home } : {},
      cwd: opts.dir,
    },
    (chunk) => opts.onUpdate?.({ kind: "stderr", attempt: 0, payload: chunk }),
  );
  await proc.request(
    "initialize",
    {
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "lububble", version: "0.1.0" },
    },
    60_000,
  );
  if (opts.replay) {
    const chat = await import("./chat.js");
    const listener = (u: AcpSessionUpdate) => {
      const mapped = chat.mapAgentUpdateToLines(u);
      if (mapped) chat.appendChatLine(opts.projectId, mapped.line, mapped.append);
    };
    proc.updates.on("update", listener);
    try {
      const previousId = await newestSessionId(proc, opts.dir);
      console.log(`[chat-history] newest session for ${opts.dir}: ${previousId || "(none)"}`);
      if (previousId) {
        try {
          const loaded = (await proc.request(
            "session/load",
            { cwd: opts.dir, sessionId: previousId, mcpServers: [] },
            120_000,
          )) as { sessionId?: string } | null;
          if (loaded) {
            const chat2 = await import("./chat.js");
            console.log(`[chat-history] load OK, mirror lines: ${chat2.readChat(opts.projectId).length}`);
            return { proc, sessionId: previousId, cwd: opts.dir, resumed: true, lastUsed: Date.now() };
          }
        } catch (loadErr) {
          console.error(`[chat-history] session/load failed: ${(loadErr as Error).message.slice(0, 300)}`);
          loadFailureLog(previousId);
        }
      }
    } finally {
      proc.updates.removeListener("update", listener);
    }
  }
  const session = (await proc.request(
    "session/new",
    {
      cwd: opts.dir,
      mcpServers: [],
    },
    120_000,
  )) as { sessionId: string };
  return { proc, sessionId: session.sessionId, cwd: opts.dir, resumed: false, lastUsed: Date.now() };
}

function loadFailureLog(_sessionId: string): void {
  console.error("hermes session/load failed; falling back to session/new");
}

function textOf(updates: AcpSessionUpdate[]): string {
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

export interface PromptAttachment {
  name: string;
  path: string;
  isImage: boolean;
  mimeType?: string;
}

export async function runAgent(
  projectId: string,
  text: string,
  attachments: PromptAttachment[] = [],
  onUpdate?: (event: AgentEvent) => void,
): Promise<AgentRunResult> {
  if (!(await listProjects()).some((p) => p.id === projectId)) {
    throw new Error(`unknown project: ${projectId}`);
  }
  const dir = await projectDir(projectId);
  await ensureMcpBuild();

  let pooled = pool.get(projectId);
  if (!pooled || pooled.proc.exited || pooled.cwd !== dir) {
    if (pooled && !pooled.proc.exited) pooled.proc.kill();
    const chat = await import("./chat.js");
    pooled = await spawnAgent({ projectId, dir, replay: chat.readChat(projectId).length === 0, onUpdate });
    pool.set(projectId, pooled);
  }
  let pooled_ = pooled;
  pooled_.lastUsed = Date.now();

  let attempt = 1;
  let current = text;
  let reply = "";
  let lastError: Error | null = null;
  let atts = attachments;
  while (attempt <= MAX_ITERATIONS) {
    const collected: AcpSessionUpdate[] = [];
    const listener = (u: AcpSessionUpdate) => {
      collected.push(u);
      onUpdate?.({ kind: "update", attempt, payload: u });
    };
    pooled_.proc.updates.on("update", listener);
    let thrown: Error = new Error("agent ended turn without completion");
    try {
      const result = (await pooled_.proc.request(
        "session/prompt",
        { sessionId: pooled_.sessionId, prompt: await buildPromptBlocks(current, atts, dir) },
        PROMPT_TIMEOUT_MS,
      )) as { stopReason?: string };
      reply = extractText(collected);
      const snap = await snapshot(dir, `iteration ${attempt}: ${text.slice(0, 120)}`);
      onUpdate?.({ kind: "iteration", attempt, payload: { snapshot: snap.detail } });
      pooled_.lastUsed = Date.now();
      if (result?.stopReason === "end_turn") {
        return { ok: true, reply, attempts: attempt };
      }
      if (result?.stopReason === "refusal" || result?.stopReason === "cancelled") {
        return { ok: false, reply, attempts: attempt };
      }
    } catch (e) {
      thrown = e as Error;
      lastError = thrown;
      if (pooled_.proc.exited) {
        try {
          const fresh = await spawnAgent({ projectId, dir, replay: false, onUpdate });
          pool.set(projectId, fresh);
          pooled_ = fresh;
        } catch (spawnErr) {
          throw spawnErr;
        }
      }
    } finally {
      pooled_.proc.updates.removeListener("update", listener);
    }
    lastError = thrown;
    if (attempt >= MAX_ITERATIONS) break;
    attempt += 1;
    atts = [];
    current = `Previous attempt failed or ended without fulfilling the task. Error: ${lastError.message}. Continue working as instructed until the task is verified complete, then finish.`;
    onUpdate?.({ kind: "iteration", attempt, payload: { error: lastError.message } });
  }
  return { ok: false, reply, attempts: attempt };
}

async function buildPromptBlocks(
  text: string,
  attachments: PromptAttachment[],
  dir: string,
): Promise<{ type: string; text?: string; data?: string; mimeType?: string }[]> {
  const blocks: { type: string; text?: string; data?: string; mimeType?: string }[] = [];
  const fs = await import("fs");
  for (const att of attachments) {
    if (att.isImage && att.mimeType) {
      const data = await fs.promises.readFile(path.join(dir, att.path), "base64");
      blocks.push({ type: "image", data, mimeType: att.mimeType });
    } else {
      blocks.push({
        type: "text",
        text: `User attached a file: ${att.name} (available in the project directory at ${att.path}).`,
      });
    }
  }
  blocks.push({ type: "text", text });
  return blocks;
}

export async function getChatHistory(projectId: string): Promise<unknown[]> {
  if (!(await listProjects()).some((p) => p.id === projectId)) {
    throw new Error(`unknown project: ${projectId}`);
  }
  const chat = await import("./chat.js");
  if (chat.readChat(projectId).length > 0) return chat.readChat(projectId);
  const dir = await projectDir(projectId);
  let pooled = pool.get(projectId);
  if (pooled && !pooled.resumed && !pooled.proc.exited && pooled.cwd === dir) {
    pooled.proc.kill();
    pooled = undefined;
  }
  if (!pooled || pooled.proc.exited || pooled.cwd !== dir) {
    pooled = await spawnAgent({ projectId, dir, replay: true });
    pool.set(projectId, pooled);
  }
  return chat.readChat(projectId);
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

export function killAgent(projectId: string): void {
  const pooled = pool.get(projectId);
  if (!pooled) return;
  if (!pooled.proc.exited) pooled.proc.kill();
  pool.delete(projectId);
}

export function killAllAgents(): void {
  for (const [projectId, pooled] of pool) {
    if (!pooled.proc.exited) pooled.proc.kill();
    pool.delete(projectId);
  }
}

export function poolSize(): number {
  return pool.size;
}
