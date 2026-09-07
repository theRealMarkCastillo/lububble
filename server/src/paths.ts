import os from "os";
import path from "path";

export const CONFIG_DIR = path.join(os.homedir(), ".lububble");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
export const PORT_REGISTRY_FILE = path.join(CONFIG_DIR, "ports.json");
export const PROJECTS_DIR = path.join(os.homedir(), "lububble-projects");
export const PROJECT_REGISTRY_FILE = path.join(CONFIG_DIR, "projects.json");
