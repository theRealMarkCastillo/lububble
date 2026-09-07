import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";

export interface AcpSpawnOptions {
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface AcpSessionUpdate {
  method: string;
  params: Record<string, unknown>;
}

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer?: NodeJS.Timeout;
}

export class AcpProcess {
  readonly updates = new EventEmitter();
  readonly stderrLines: string[] = [];
  private proc: ChildProcess;
  private buffer = "";
  private nextId = 1;
  private pending = new Map<number, Pending>();
  exited = false;

  constructor(
    readonly opts: AcpSpawnOptions,
    onStderr?: (text: string) => void,
  ) {
    this.proc = spawn(opts.command, opts.args, {
      cwd: opts.cwd ?? process.cwd(),
      env: { ...process.env, ...(opts.env ?? {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.proc.on("exit", (code) => {
      this.exited = true;
      for (const p of this.pending.values()) p.reject(new Error(`agent exited (code ${code ?? "?"})`));
      this.pending.clear();
    });
    this.proc.stdout!.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString("utf8");
      for (;;) {
        const nl = this.buffer.indexOf("\n");
        if (nl === -1) break;
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        if (line) this.handleLine(line);
      }
    });
    this.proc.stderr!.on("data", (c: Buffer) => {
      onStderr?.(c.toString("utf8"));
    });
    this.proc.on("error", (e) => {
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    });
  }

  private handleLine(line: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const key = Number(msg.id);
      const p = this.pending.get(key);
      if (!p) return;
      this.pending.delete(key);
      if (msg.error) p.reject(new Error(`agent error: ${JSON.stringify(msg.error)}`));
      else p.resolve(msg.result);
      return;
    }
    if (typeof msg.method === "string") {
      if (msg.method.startsWith("fs/") || msg.method.startsWith("terminal/")) {
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32601, message: "not implemented by lububble client" },
        });
        return;
      }
      if (msg.method === "session/request_permission") {
        const params = msg.params as { options?: { optionId: string; kind?: string; name?: string }[] };
        const picked =
          params.options?.find((o) => o.kind === "allow_once") ??
          params.options?.find((o) => o.kind === "allow_always") ??
          params.options?.[0];
        this.send({
          jsonrpc: "2.0",
          id: msg.id,
          result: { outcome: { outcome: "selected", optionId: picked?.optionId ?? "" } },
        });
        return;
      }
      this.updates.emit("update", msg as unknown as AcpSessionUpdate);
    }
  }

  private send(obj: unknown): void {
    if (this.exited) throw new Error("agent process has exited");
    this.proc.stdin!.write(`${JSON.stringify(obj)}\n`);
  }

  async request(method: string, params: Record<string, unknown> | undefined, timeoutMs = 900_000): Promise<unknown> {
    if (this.exited) throw new Error("agent process has exited");
    const id = this.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      const p: Pending = { resolve, reject };
      p.timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`agent request timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, p);
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (e) {
        clearTimeout(p.timer);
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  kill(): void {
    if (!this.exited) this.proc.kill("SIGTERM");
  }
}
