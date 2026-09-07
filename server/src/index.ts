import express from "express";
import path from "path";
import { loadConfig, saveConfig, redactConfig, ConfigSchema, type Config } from "./config.js";
import { listProjects, createProject, deleteProject, projectDir } from "./projects.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, name: "lububble", version: "0.1.0" });
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
        if (!p.apiKey.includes("••")) return p;
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
      if (!name.trim()) return res.status(400).json({ error: "name is required" });
      const { project, ports } = await createProject(name);
      res.status(201).json({ project, ports });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    const result = await deleteProject(req.params.id);
    res.json(result);
  });

  app.get("/api/projects/:id/files", async (req, res) => {
    try {
      const dir = await projectDir(req.params.id);
      const { walk } = await import("./walk.js");
      const files = await walk(dir, dir);
      res.json({ files });
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

  app.put("/api/projects/:id/file", express.json({ limit: "8mb", type: ["application/json", "text/plain"] }), async (req, res) => {
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

  return app;
}
