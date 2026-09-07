import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";
import { readManifest } from "./evidence.js";
import { composeAction } from "./compose.js";

const WORKSPACE_ROOT = process.env.LUBUBBLE_WORKSPACE_ROOT
  ? path.resolve(process.env.LUBUBBLE_WORKSPACE_ROOT)
  : path.join(process.env.HOME ?? "", "lububble-projects");

function resolveScope(rel: string, action: string): string {
  const target = path.resolve(WORKSPACE_ROOT, rel);
  if (target !== WORKSPACE_ROOT && !target.startsWith(WORKSPACE_ROOT + path.sep)) {
    throw new Error(`${action} path escapes workspace root: ${rel}`);
  }
  return target;
}

function toolResult(ok: boolean, output: string) {
  return {
    isError: !ok,
    content: [{ type: "text" as const, text: `${ok ? "OK" : "FAILED"}\n${output.slice(-8000)}` }],
  };
}

export function createServer() {
  const server = new McpServer({ name: "lububble-tools", version: "0.2.0" });

  server.tool(
    "list_files",
    "Recursively list files under a workspace-relative directory",
    { path: z.string().default(".") },
    async ({ path: p }) => {
      const target = resolveScope(p, "list_files");
      const walk = async (dir: string, prefix: string): Promise<string[]> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        const out: string[] = [];
        for (const e of entries) {
          if (e.name === "node_modules" || e.name === ".git" || e.name === ".next" || e.name === "dist") continue;
          const rel = prefix ? `${prefix}/${e.name}` : e.name;
          if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
          else out.push(rel);
        }
        return out;
      };
      const files = await walk(target, p === "." ? "" : p);
      return { content: [{ type: "text", text: files.slice(0, 2000).join("\n") || "(empty)" }] };
    },
  );

  server.tool(
    "read_file",
    "Read a file (workspace-relative path)",
    { path: z.string() },
    async ({ path: p }) => {
      const target = resolveScope(p, "read_file");
      const text = await fs.readFile(target, "utf8");
      return { content: [{ type: "text", text }] };
    },
  );

  server.tool(
    "write_file",
    "Create or overwrite a file with full content (workspace-relative path). Creates parent dirs.",
    { path: z.string(), content: z.string() },
    async ({ path: p, content }) => {
      const target = resolveScope(p, "write_file");
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
      return { content: [{ type: "text", text: `wrote ${p} (${content.length} bytes)` }] };
    },
  );

  server.tool(
    "delete_file",
    "Delete a file (workspace-relative path)",
    { path: z.string() },
    async ({ path: p }) => {
      await fs.rm(resolveScope(p, "delete_file"));
      return { content: [{ type: "text", text: `deleted ${p}` }] };
    },
  );

  server.tool(
    "run_history",
    "Fetch the evidence manifest (run history) for a project",
    { project: z.string() },
    async ({ project }) => {
      const records = await readManifest(project);
      return { content: [{ type: "text", text: records.map((r) => JSON.stringify(r)).join("\n") || "(no runs)" }] };
    },
  );

  server.tool(
    "compose_up",
    "Validates compose policy, then builds and starts the project's stack",
    {
      project_dir: z.string().describe("Workspace-relative project directory containing the compose file"),
      files: z.array(z.string()).default(["docker-compose.yml"]),
    },
    async (args) => {
      try {
        const r = await composeAction("compose_up", args, { workspaceRoot: WORKSPACE_ROOT });
        return toolResult(r.ok, r.output);
      } catch (e) {
        return toolResult(false, e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "compose_down",
    "Stop and remove the project's Compose stack (removes volumes)",
    {
      project_dir: z.string(),
      files: z.array(z.string()).default(["docker-compose.yml"]),
    },
    async (args) => {
      try {
        const r = await composeAction("compose_down", args, { workspaceRoot: WORKSPACE_ROOT });
        return toolResult(r.ok, r.output);
      } catch (e) {
        return toolResult(false, e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "compose_logs",
    "Fetch recent logs from the project's Compose stack",
    {
      project_dir: z.string(),
      files: z.array(z.string()).default(["docker-compose.yml"]),
    },
    async (args) => {
      try {
        const r = await composeAction("compose_logs", args, { workspaceRoot: WORKSPACE_ROOT });
        return toolResult(r.ok, r.output);
      } catch (e) {
        return toolResult(false, e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.tool(
    "http_check",
    "HTTP GET a local URL; returns status + body head. Use to verify the app is up.",
    { url: z.string().url(), expect_status: z.number().int().min(100).max(599).default(200) },
    async ({ url, expect_status }) => {
      try {
        const res = await fetch(url, { redirect: "follow" });
        const body = (await res.text()).slice(0, 1500);
        return {
          content: [{ type: "text", text: `status=${res.status} expected=${expect_status}\n---\n${body}` }],
          isError: res.status !== expect_status,
        };
      } catch (e) {
        return { isError: true, content: [{ type: "text", text: `unreachable: ${(e as Error).message}` }] };
      }
    },
  );

  return server;
}

export async function startStdio() {
  const server = createServer();
  await server.connect(new StdioServerTransport());
}
