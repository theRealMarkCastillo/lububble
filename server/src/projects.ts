import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { PROJECTS_DIR, PROJECT_REGISTRY_FILE } from "./paths.js";
import { allocatePorts, releasePorts, getPorts } from "./ports.js";
import { composeDown, guardedDocker } from "./docker.js";
import { gitInit } from "./snapshots.js";
import { fileURLToPath } from "url";

const thisDir = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_ROOT = path.resolve(thisDir, "..", "templates");
const TEMPLATE_NAMES = new Set(["next-lite", "next-postgres"]);
const TEMPLATE_DATA_ENV: Record<string, string> = {
  "next-lite": "",
  "next-postgres": "DATABASE_URL=postgres://lububble:lububble@db:5432/app\n",
};

function slugify(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(trimmed)) {
    throw new Error(`project name must start with a letter/number and contain only letters, numbers, spaces, "_" or "-": "${name}"`);
  }
  const slug = trimmed.toLowerCase().replace(/\s+/g, "-");
  return slug;
}

const RegistrySchema = z.array(
  z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
  }),
);
export type ProjectRecord = z.infer<typeof RegistrySchema>[number];

async function readRegistry(): Promise<ProjectRecord[]> {
  try {
    return RegistrySchema.parse(JSON.parse(await fs.readFile(PROJECT_REGISTRY_FILE, "utf8")));
  } catch {
    return [];
  }
}

async function writeRegistry(list: ProjectRecord[]): Promise<void> {
  await fs.writeFile(PROJECT_REGISTRY_FILE, JSON.stringify(list, null, 2));
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return readRegistry();
}

export async function stopOrphanStacks(): Promise<string[]> {
  const listed = await guardedDocker("orphan_sweep_list", "orphan-sweep", [
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project",
    "--format",
    "{{.Label \"com.docker.compose.project\"}}\t{{.ID}}",
  ]);
  if (!listed.ok) return [];
  const registered = new Set(
    (await listProjects()).flatMap((p) => {
      const base = `lububble-${p.id.replace(/[^a-z0-9_-]+/g, "-")}`;
      return [base, `${base}-prod`];
    }),
  );
  const seen = new Map<string, string[]>();
  for (const line of listed.output.trim().split("\n")) {
    if (!line) continue;
    const [project = "", id = ""] = line.split("\t");
    if (!project.startsWith("lububble-") || registered.has(project)) continue;
    (seen.get(project) ?? seen.set(project, []).get(project)!).push(id);
  }
  const notes: string[] = [];
  for (const [project, ids] of seen) {
    const rm = await guardedDocker("orphan_sweep_remove", project, ["rm", "-f", ...ids], { timeoutMs: 120_000 });
    notes.push(`${project}: removed ${ids.length} orphan container(s) (exit ${rm.exitCode ?? "?"})`);
  }
  return notes;
}

export async function createProject(
  name: string,
  template = "next-lite",
): Promise<{ project: ProjectRecord; ports: { dev: number; prod: number; staging: number } }> {
  const slug = slugify(name);
  const registry = await readRegistry();
  if (registry.some((p) => p.id === slug)) throw new Error(`project "${slug}" already exists`);
  if (!TEMPLATE_NAMES.has(template)) throw new Error(`unknown template: "${template}"`);

  const projectDir = path.join(PROJECTS_DIR, slug);
  await fs.cp(path.join(TEMPLATE_ROOT, template), projectDir, { recursive: true });

  const ports = await allocatePorts(slug);
  await fs.writeFile(
    path.join(projectDir, ".env"),
    `APP_PORT=${ports.dev}\n${TEMPLATE_DATA_ENV[template] ?? ""}`,
    "utf8",
  );
  await gitInit(projectDir);

  const record: ProjectRecord = {
    id: slug,
    name: name.trim() || slug,
    createdAt: new Date().toISOString(),
  };
  registry.push(record);
  await writeRegistry(registry);
  return { project: record, ports };
}

export async function deleteProject(id: string): Promise<{ ok: boolean; notes: string[] }> {
  const registry = await readRegistry();
  const idx = registry.findIndex((p) => p.id === id && /^[a-z0-9][a-z0-9-]*$/.test(id));
  if (idx === -1) {
    const safeDir = path.resolve(PROJECTS_DIR, id.replace(/\.\./g, ""));
    if (safeDir === PROJECTS_DIR || !safeDir.startsWith(PROJECTS_DIR + path.sep)) {
      return { ok: true, notes: ["unknown project; registry untouched"] };
    }
    await fs.rm(safeDir, { recursive: true, force: true });
    return { ok: true, notes: ["unknown project; removed workspace dir only"] };
  }

  const notes: string[] = [];
  const projectDir = path.join(PROJECTS_DIR, id);
  const ports = await getPorts(id);
  await releasePorts(id);

  if (await fs.stat(projectDir).then(() => true, () => false).catch(() => false)) {
    const down = await composeDown(projectDir, id);
    notes.push(down.ok ? "compose stack stopped" : "compose stop failed (ignored)");
    await fs.rm(projectDir, { recursive: true, force: true });
    notes.push("workspace removed");
  }
  await writeRegistry(registry.filter((_, i) => i !== idx));
  notes.push(`released ports: ${JSON.stringify(ports)}`);
  return { ok: true, notes };
}

export async function projectDir(id: string): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("invalid project id");
  return path.join(PROJECTS_DIR, id);
}
