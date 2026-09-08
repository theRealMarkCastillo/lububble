import { execFile } from "child_process";
import { composeAction, record, type ComposeResult } from "@lububble/mcp-tools/dist/compose.js";
import { composeProjectName, validateComposeFiles } from "@lububble/mcp-tools/dist/policy.js";
import { captureSnapshot, diffSnapshots } from "@lububble/mcp-tools/dist/snapshot.js";
import { PROJECTS_DIR } from "./paths.js";

export { composeProjectName, validateComposeFiles };

export async function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, timeout: opts.timeoutMs ?? 600_000, maxBuffer: 64 * 1024 * 1024, ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}) },
      (err, stdout, stderr) => {
        const raw = err ? (err as unknown as { code?: unknown }).code : undefined;
        const code = typeof raw === "number" ? raw : err ? 1 : 0;
        resolve({ code, text: `${stdout}${stderr}` });
      },
    );
  });
}

export interface ComposeRun {
  ok: boolean;
  output: string;
}

export async function composeActionForProject(
  action: "compose_up" | "compose_down" | "compose_logs",
  projectDir: string,
  options: { files?: string[]; projectName?: string; env?: Record<string, string>; removeVolumes?: boolean } = {},
): Promise<ComposeResult> {
  return composeAction(
    action,
    {
      project_dir: projectDir,
      files: options.files ?? ["docker-compose.yml"],
      project_name: options.projectName,
      env: options.env,
      remove_volumes: options.removeVolumes,
    },
    { workspaceRoot: PROJECTS_DIR },
  );
}

export async function guardedDocker(
  tool: string,
  project: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<ComposeResult> {
  return record({ workspaceRoot: PROJECTS_DIR }, tool, project, async () => {
    const before = await captureSnapshot();
    const { code, text } = await run("docker", args, options);
    const after = await captureSnapshot();
    const { foreignChanges } = diffSnapshots(before, after);
    return {
      ok: code === 0 && foreignChanges.length === 0,
      exitCode: code,
      output: foreignChanges.length ? `${text}\nSAFETY: foreign container changes detected: ${foreignChanges.join(", ")}` : text,
      policyViolations: [],
      foreignContainerChanges: foreignChanges,
    };
  });
}

export async function composeDown(projectDir: string, dirName: string): Promise<ComposeRun> {
  const result = await composeActionForProject("compose_down", projectDir, { projectName: composeProjectName(dirName) });
  return { ok: result.ok, output: result.output.slice(-4000) };
}
