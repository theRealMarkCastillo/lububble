import { promises as fs } from "fs";
import path from "path";
import { PORT_REGISTRY_FILE } from "./paths.js";

const DEV_PORT_BASE = 14000;
const PROD_PORT_BASE = 15000;
const MAX_PORT_SPAN = 900;

type Registry = Record<string, { dev: number; prod: number; staging: number }>;

async function read(): Promise<Registry> {
  try {
    return JSON.parse(await fs.readFile(PORT_REGISTRY_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function write(reg: Registry): Promise<void> {
  await fs.mkdir(path.dirname(PORT_REGISTRY_FILE), { recursive: true });
  await fs.writeFile(PORT_REGISTRY_FILE, JSON.stringify(reg, null, 2));
}

async function usedPorts(reg: Registry): Promise<Set<number>> {
  const s = new Set<number>();
  for (const v of Object.values(reg)) for (const p of Object.values(v)) s.add(p);
  return s;
}

async function nextPort(base: number, taken: Set<number>): Promise<number> {
  for (let i = 0; i <= MAX_PORT_SPAN; i++) {
    const p = base + i;
    if (!taken.has(p)) return p;
  }
  throw new Error(`no free ports in range ${base}..${base + MAX_PORT_SPAN}`);
}

export async function allocatePorts(projectName: string): Promise<{ dev: number; prod: number; staging: number }> {
  const reg = await read();
  const taken = await usedPorts(reg);
  reg[projectName] = {
    dev: await nextPort(DEV_PORT_BASE, taken),
    prod: await nextPort(PROD_PORT_BASE, taken),
    staging: await nextPort(17000, taken),
  };
  await write(reg);
  return reg[projectName];
}

export async function releasePorts(projectName: string): Promise<void> {
  const reg = await read();
  delete reg[projectName];
  await write(reg);
}

export async function getPorts(projectName: string): Promise<ReturnType<typeof allocatePorts> | null> {
  return (await read())[projectName] ?? null;
}
