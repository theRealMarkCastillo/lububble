import path from "node:path";
import { run as runImpl } from "./run.js";
import { PolicyViolation, composeProjectName, validateComposeFiles } from "./policy.js";
import { captureSnapshot as captureImpl, diffSnapshots as diffImpl, type Snapshot } from "./snapshot.js";
import { appendEvent as appendEventImpl, type RunRecord } from "./evidence.js";

export interface ComposeResult {
  ok: boolean;
  exitCode: number | null;
  output: string;
  policyViolations: string[];
  foreignContainerChanges: string[];
}

export interface ComposeDeps {
  workspaceRoot: string;
  run?: typeof runImpl;
  captureSnapshot?: typeof captureImpl;
  diffSnapshots?: typeof diffImpl;
  appendEvent?: typeof appendEventImpl;
}

export function resolveScope(root: string, rel: string, action: string): string {
  const target = path.resolve(root, rel);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`${action} path escapes workspace root: ${rel}`);
  }
  return target;
}

export async function record(
  deps: ComposeDeps,
  toolName: string,
  project: string,
  fn: () => Promise<ComposeResult>,
): Promise<ComposeResult> {
  const appendEvent = deps.appendEvent ?? appendEventImpl;
  const started = Date.now();
  try {
    const result = await fn();
    await appendEvent({
      timestamp: new Date().toISOString(),
      tool: toolName,
      project,
      ...result,
      durationS: (Date.now() - started) / 1000,
    });
    return result;
  } catch (e) {
    const violated = e instanceof PolicyViolation;
    await appendEvent({
      timestamp: new Date().toISOString(),
      tool: toolName,
      project,
      ok: false,
      exitCode: null,
      policyViolations: violated ? [(e as Error).message] : [],
      foreignContainerChanges: [],
      output: "",
      durationS: (Date.now() - started) / 1000,
    });
    throw e;
  }
}

export async function composeAction(
  toolName: string,
  args: { project_dir: string; files: string[] },
  deps: ComposeDeps,
): Promise<ComposeResult> {
  const run = deps.run ?? runImpl;
  const captureSnapshot = deps.captureSnapshot ?? captureImpl;
  const diffSnapshots = deps.diffSnapshots ?? diffImpl;
  const cwd = resolveScope(deps.workspaceRoot, args.project_dir, toolName);
  const project = composeProjectName(path.basename(cwd));
  const files = args.files?.length ? args.files : ["docker-compose.yml"];

  return record(deps, toolName, path.basename(cwd), async () => {
    const before = await captureSnapshot();
    let output = "";
    let policyViolations: string[] = [];
    const fileFlags = files.flatMap((f) => ["-f", f]);
    const composeArgs =
      toolName === "compose_up"
        ? ["compose", "-p", project, ...fileFlags, "up", "-d", "--build", "--remove-orphans", "--wait", "--wait-timeout", "180"]
        : toolName === "compose_down"
          ? ["compose", "-p", project, ...fileFlags, "down", "--remove-orphans", "--volumes"]
          : ["compose", "-p", project, ...fileFlags, "logs", "--tail", "200"];
    try {
      await validateComposeFiles(cwd, files).catch((e: unknown) => {
        policyViolations = [e instanceof PolicyViolation ? `policy: ${e.message}` : String(e)];
        throw e;
      });
      const { code, text } = await run("docker", composeArgs, { cwd });
      output = text;
      if (toolName === "compose_up" && code !== 0) {
        const teardown = await run("docker", ["compose", "-p", project, ...fileFlags, "down", "--remove-orphans", "--volumes"], { cwd }).catch((downErr: Error) => ({
          code: -1,
          text: downErr.message,
        }));
        output += `\nteardown attempted after failed up: exit ${teardown.code}`;
      }
      const after = await captureSnapshot();
      const { foreignChanges } = diffSnapshots(before, after);
      if (foreignChanges.length) {
        output += `\nSAFETY: foreign container changes detected: ${foreignChanges.join(", ")}`;
        return { ok: false, exitCode: code, output, policyViolations, foreignContainerChanges: foreignChanges };
      }
      return { ok: code === 0, exitCode: code, output, policyViolations, foreignContainerChanges: [] };
    } catch (e) {
      if (policyViolations.length) {
        return { ok: false, exitCode: null, output: (e as Error).message, policyViolations, foreignContainerChanges: [] };
      }
      if (toolName === "compose_up") {
        const teardown = await run("docker", ["compose", "-p", project, ...fileFlags, "down", "--remove-orphans", "--volumes"], { cwd }).catch((downErr: Error) => ({
          code: -1,
          text: downErr.message,
        }));
        output = `${(e as Error).message}\nteardown attempted: exit ${teardown.code}`;
      }
      throw e;
    }
  });
}

export type { RunRecord };