import { promises as fs } from "fs";
import path from "path";
import YAML from "yaml";

export class PolicyViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyViolation";
  }
}

export function composeProjectName(dirName: string): string {
  const slug =
    dirName
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/^[^a-z0-9]+/, "") || "project";
  return `lububble-${slug}`;
}

const SENSITIVE_HOST_ROOTS = ["/", "/etc", "/var", "/home", "/root", "/Users"];

interface ComposeDoc {
  services?: Record<string, ComposeService>;
  networks?: Record<string, { external?: boolean; name?: string }>;
}

interface ComposeService {
  [key: string]: unknown;
}

function checkBindSource(projectDir: string, source: string): void {
  if (source === "/var/run/docker.sock") {
    throw new PolicyViolation("docker socket mounts are not allowed");
  }
  if (!source.startsWith("/")) {
    if (source === "." || source === ".." || source.startsWith("./") || source.startsWith("../")) {
      const resolved = path.resolve(projectDir, source);
      const rel = path.relative(path.resolve(projectDir), resolved);
      if (rel === ".." || rel.startsWith(`..${path.sep}`)) {
        throw new PolicyViolation(`bind mount escapes project directory: ${source}`);
      }
      return;
    }
    if (SENSITIVE_HOST_ROOTS.includes(source)) {
      throw new PolicyViolation(`sensitive bind mount: ${source}`);
    }
    return;
  }
  const resolved = path.resolve(source);
  const rel = path.relative(path.resolve(projectDir), resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`)) {
    throw new PolicyViolation(`absolute bind mount outside project: ${source}`);
  }
  if (hostRootSensitive(resolved)) {
    throw new PolicyViolation(`sensitive bind mount: ${source}`);
  }
}

function hostRootSensitive(resolved: string): boolean {
  return ["/etc", "/var", "/home", "/root", "/Users"].some((root) => {
    const rel = path.relative(root, resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel) && (root === "/etc" || root === "/var" || root === "/home" || root === "/root" || root === "/Users"));
  });
}

function assertServiceSafe(name: string, svc: ComposeService, projectDir: string | undefined): void {
  if (svc["privileged"] === true) throw new PolicyViolation(`${name}: privileged is not allowed`);
  if (svc["cap_add"] !== undefined) throw new PolicyViolation(`${name}: cap_add is not allowed`);
  if (svc["devices"] !== undefined) throw new PolicyViolation(`${name}: devices is not allowed`);
  if (svc["userns_mode"] !== undefined) throw new PolicyViolation(`${name}: userns_mode is not allowed`);
  if (svc["pid"] === "host" || svc["ipc"] === "host" || svc["network_mode"] === "host") {
    throw new PolicyViolation(`${name}: host namespace sharing is not allowed`);
  }
  if (svc["container_name"] !== undefined) {
    throw new PolicyViolation(`${name}: container_name is not allowed (project-scoped names only)`);
  }
  if (svc["restart"] === "always") {
    throw new PolicyViolation(`${name}: restart: always is not allowed`);
  }
  const securityOpts = (svc["security_opt"] as string[] | undefined) ?? [];
  for (const opt of securityOpts) {
    if (["seccomp:unconfined", "apparmor:unconfined", "label:disable"].includes(opt)) {
      throw new PolicyViolation(`${name}: security_opt "${opt}" is not allowed`);
    }
  }
  if (projectDir !== undefined) {
    const volumes = (svc["volumes"] as string[] | undefined) ?? [];
    for (const vol of volumes) {
      const source = vol.split(":")[0];
      checkBindSource(projectDir, source);
    }
  }
  const ports = (svc["ports"] as unknown[] | undefined) ?? [];
  for (const p of ports) {
    const spec = typeof p === "string" ? p : JSON.stringify(p);
    if (typeof p !== "string" || !/^(\$\{APP_PORT:-\d+\}):\d+$/.test(spec)) {
      throw new PolicyViolation(`${name}: host port "${spec}" must be an allocated \${APP_PORT:-...}:<container> pair`);
    }
  }
}

export function assertSafeComposeFile(doc: ComposeDoc | null | undefined, projectDir?: string): void {
  if (!doc || typeof doc !== "object") return;
  for (const [name, net] of Object.entries(doc.networks ?? {})) {
    if (net.external) throw new PolicyViolation(`external network "${name}" is not allowed`);
  }
  for (const [name, svc] of Object.entries(doc.services ?? {})) {
    assertServiceSafe(name, svc, projectDir);
  }
}

export async function validateComposeFiles(projectDir: string, files: string[]): Promise<void> {
  for (const file of files) {
    const target = path.resolve(projectDir, file);
    const raw = await fs.readFile(target, "utf8");
    const parsed = YAML.parse(raw) as ComposeDoc | null;
    assertSafeComposeFile(parsed, projectDir);
  }
}
