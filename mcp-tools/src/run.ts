import { execFile } from "child_process";

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {},
): Promise<{ code: number; text: string }> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 600_000,
        maxBuffer: 64 * 1024 * 1024,
        ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
      },
      (err, stdout, stderr) => {
        const raw = err ? (err as unknown as { code?: unknown }).code : undefined;
        const code = typeof raw === "number" ? raw : err ? 1 : 0;
        resolve({ code, text: `${stdout}${stderr}` });
      },
    );
  });
}
