import express from "express";
import path from "path";
import { loadConfig, saveConfig, redactConfig, ConfigSchema, type Config } from "./config.js";
import { listProjects, createProject, deleteProject, projectDir } from "./projects.js";
import { getPorts } from "./ports.js";
import { history, restore } from "./snapshots.js";
import { run } from "./docker.js";
import { PROJECTS_DIR } from "./paths.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, name: "lububble", version: "0.2.0" });
  });

  app.get("/api/config", async (_req, res) => {
    res.json({ config: redactConfig(await loadConfig()) });
  });

  app.put("/api/config", async (req, res) => {
    const parsed = ConfigSchema.safeParse(req.body?.config);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const current = await loadConfig();
    const incoming = parsed.data;
    const merged: Config = {
      defaultProviderId: incoming.defaultProviderId,
      providers: incoming.providers.map((p) => {
        if (!p.apiKey.includes("•")) return p;
        const existing = current.providers.find((c) => c.id === p.id);
        return { ...p, apiKey: existing?.apiKey ?? "" };
      }),
    };
    await saveConfig(merged);
    res.json({ config: redactConfig(merged) });
  });

  app.get("/api/projects", async (_req, res) => {
    res.json({ projects: await listProjects() });
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const name = typeof req.body?.name === "string" ? req.body.name : "";
      const template = typeof req.body?.template === "string" ? req.body.template : "next-lite";
      if (!name.trim()) return res.status(400).json({ error: "name is required" });
      const { project, ports } = await createProject(name, template);
      res.status(201).json({ project, ports });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    const { killAgent } = await import("./agent.js");
    killAgent(req.params.id);
    const result = await deleteProject(req.params.id);
    res.json(result);
  });

  app.get("/api/projects/:id/ports", async (req, res) => {
    try {
      let ports = await getPorts(req.params.id);
      if (!ports) {
        const { allocatePorts } = await import("./ports.js");
        ports = await allocatePorts(req.params.id);
      }
      res.json({ ports });
    } catch {
      res.status(404).json({ error: "unknown project" });
    }
  });

  app.get("/api/projects/:id/files", async (req, res) => {
    try {
      const dir = await projectDir(req.params.id);
      const { walk } = await import("./walk.js");
      res.json({ files: await walk(dir, dir) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get("/api/projects/:id/file", async (req, res) => {
    try {
      const dir = await projectDir(req.params.id);
      const rel = String(req.query.path ?? "");
      const target = path.resolve(dir, rel);
      if (!target.startsWith(dir + path.sep)) return res.status(400).json({ error: "path escapes project" });
      res.type("text/plain").send(await (await import("fs/promises")).readFile(target, "utf8"));
    } catch {
      res.status(404).json({ error: "not found" });
    }
  });

  app.put("/api/projects/:id/file", async (req, res) => {
    try {
      const dir = await projectDir(req.params.id);
      const rel = String(req.query.path ?? "");
      const target = path.resolve(dir, rel);
      if (!target.startsWith(dir + path.sep)) return res.status(400).json({ error: "path escapes project" });
      const fs = await import("fs/promises");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, req.body?.content ?? "", "utf8");
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get("/api/projects/:id/history", async (req, res) => {
    const dir = await projectDir(req.params.id);
    res.json({ history: await history(dir) });
  });

  app.post("/api/projects/:id/history/:hash/restore", async (req, res) => {
    const dir = await projectDir(req.params.id);
    res.json(await restore(dir, req.params.hash, `restore ${req.params.hash}`));
  });

  app.post("/api/projects/:id/dev/restart", async (req, res) => {
    try {
      const id = req.params.id;
      const dir = await projectDir(id);
      const ports = await getPorts(id);
      if (!ports) return res.status(404).json({ error: "unknown project" });
      const { composeProjectName } = await import("@lububble/mcp-tools/dist/policy.js");
      const { validateComposeFiles } = await import("./docker.js");
      await validateComposeFiles(dir, ["docker-compose.yml"]);
      const { code, text } = await run("docker", ["compose", "-p", composeProjectName(id), "-f", "docker-compose.yml", "up", "-d", "--build", "--wait", "--wait-timeout", "180"], {
        cwd: dir,
        timeoutMs: 600_000,
      });
      res.json({ ok: code === 0, url: `http://localhost:${ports.dev}`, output: text.slice(-3000) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/projects/:id/publish", async (req, res) => {
    try {
      const id = req.params.id;
      const dir = await projectDir(id);
      const ports = await getPorts(id);
      if (!ports) return res.status(404).json({ error: "unknown project" });
      const { code, text } = await run("docker", ["compose", "-p", `lububble-${id}-prod`, "-f", "docker-compose.prod.yml", "up", "-d", "--build", "--wait", "--wait-timeout", "180"], {
        cwd: dir,
        timeoutMs: 600_000,
        env: { APP_PORT: String(ports.prod) },
      });
      const { text: envOut } = { text: "" };
      void envOut;
      res.json({ ok: code === 0, port: ports.prod, url: `http://localhost:${ports.prod}`, output: text.slice(-4000) });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/projects/:id/publish/stop", async (req, res) => {
    try {
      const id = req.params.id;
      const dir = await projectDir(id);
      const { code, text } = await run("docker", ["compose", "-p", `lububble-${id}-prod`, "-f", "docker-compose.prod.yml", "down", "--remove-orphans"], {
        cwd: dir,
        timeoutMs: 120_000,
      });
      res.json({ ok: code === 0, output: text.slice(-2000) });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.get("/api/projects/:id/logs", async (req, res) => {
    const id = req.params.id;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return res.status(400).json({ error: "invalid id" });
    const dir = path.join(PROJECTS_DIR, id);
    const { composeProjectName } = await import("@lububble/mcp-tools/dist/policy.js");
    const { code, text } = await run("docker", ["compose", "-p", composeProjectName(id), "logs", "--tail", "200"], {
      cwd: dir,
      timeoutMs: 60_000,
    });
    res.type("text/plain").send(code === 0 ? text : `docker compose logs failed (exit ${code})\n${text}`);
  });

  app.post("/api/projects/:id/prompt/stream", async (req, res) => {
    const text = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    if (!text.trim()) return res.status(400).json({ error: "prompt is required" });
    const { runAgent } = await import("./agent.js");
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    req.on("close", () => send("closed", {}));
    try {
      const result = await runAgent(req.params.id, text, (e) => send("agent", e));
      send("done", result);
    } catch (e) {
      send("error", { message: (e as Error).message });
    }
    res.end();
  });

  app.post("/api/projects/:id/prompt", async (req, res) => {
    const text = typeof req.body?.prompt === "string" ? req.body.prompt : "";
    if (!text.trim()) return res.status(400).json({ error: "prompt is required" });
    const { runAgent } = await import("./agent.js");
    const events: import("./agent.js").AgentEvent[] = [];
    try {
      const result = await runAgent(req.params.id, text, (e) => {
        events.push(e);
      });
      res.json({ ...result, eventCount: events.length });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.use("/preview/:id", (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const id = (req.params as { id: string }).id;
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return next();
    const ports = await getPorts(id);
    if (!ports) return res.status(404).json({ error: "unknown project" });
    try {
      const upstream = await fetch(`http://127.0.0.1:${ports.dev}${req.url}`, {
        headers: { host: `localhost:${ports.dev}` },
        redirect: "manual",
      });
      let body = upstream.body;
      if (!body) {
        res.status(upstream.status).send("");
        return;
      }
      unsafeHeadersInto(upstream.headers, res);
      res.type(upstream.headers.get("content-type") ?? "application/octet-stream");
      const reader = body.getReader();
      res.on("close", () => reader.cancel());
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch {
      res.status(502).type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><style>body{font-family:ui-sans-serif,system-ui;background:#0b0b0d;color:#9a9aa6;display:flex;align-items:center;justify-content:center;height:100vh;font-size:13px}code{color:#7fbf7f}</style></head>
<body><div>dev stack not running for this project yet.<br/>Ask the agent to build &amp; run it, or use <code>compose_up</code> from chat.</div></body></html>`);
    }
  }) as express.RequestHandler);

  return app;
}

const BLOCKED_PREVIEW_HEADERS = new Set([
  "content-security-policy",
  "x-frame-options",
  "strict-transport-security",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "content-length",
]);

function unsafeHeadersInto(upstreamHeaders: Headers, res: express.Response): void {
  upstreamHeaders.forEach((value, key) => {
    if (BLOCKED_PREVIEW_HEADERS.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });
}
