import os from "os";
import path from "path";
import { promises as fs } from "fs";

export const HOME_DIR = os.homedir();
export const CONFIG_DIR = path.join(os.homedir(), ".lububble");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const PORT_REGISTRY_FILE = path.join(CONFIG_DIR, "ports.json");
export const PROJECTS_DIR = path.join(os.homedir(), "lububble-projects");
export const PROJECT_REGISTRY_FILE = path.join(CONFIG_DIR, "projects.json");

export async function resolveProjectPath(root: string, rel: string, action: string): Promise<string> {
  const target = path.resolve(root, rel);
  if (target === root || !target.startsWith(root + path.sep)) throw new Error(`${action} path escapes project`);
  const realRoot = await fs.realpath(root);
  let current = target;
  for (;;) {
    try {
      const resolved = await fs.realpath(current);
      if (resolved !== realRoot && !resolved.startsWith(realRoot + path.sep)) {
        throw new Error(`${action} path escapes project through a symlink`);
      }
      return target;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      const parent = path.dirname(current);
      if (parent === current) throw e;
      current = parent;
    }
  }
}
