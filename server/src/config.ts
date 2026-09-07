import { promises as fs } from "fs";
import path from "path";
import { z } from "zod";
import { CONFIG_DIR, CONFIG_FILE } from "./paths.js";

export const LlmProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url(),
  model: z.string(),
  apiKey: z.string(),
});

export const ConfigSchema = z.object({
  providers: z.array(LlmProviderSchema).default([]),
  defaultProviderId: z.string().nullable().default(null),
});

export type Config = z.infer<typeof ConfigSchema>;
export type LlmProvider = z.infer<typeof LlmProviderSchema>;

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    return ConfigSchema.parse(JSON.parse(raw));
  } catch {
    return ConfigSchema.parse({});
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  const body = JSON.stringify(config, null, 2);
  await fs.writeFile(CONFIG_FILE, body, { mode: 0o600 });
  await fs.chmod(CONFIG_FILE, 0o600).catch(() => {});
}

export function redactConfig(config: Config): Config {
  return {
    ...config,
    providers: config.providers.map((p) => ({ ...p, apiKey: p.apiKey ? "••••••••" + p.apiKey.slice(-4) : "" })),
  };
}

export function configPath(): string {
  return path.join(CONFIG_DIR, "config.json");
}
