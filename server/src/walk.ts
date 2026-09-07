import { promises as fs } from "fs";
import path from "path";

const IGNORE = new Set(["node_modules", ".git", ".next", "dist", ".lububble"]);

export async function walk(dir: string, root: string, prefix = ""): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    if (e.name === ".env" || IGNORE.has(e.name)) continue;
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), root, rel)));
    else out.push(rel);
  }
  return out;
}
