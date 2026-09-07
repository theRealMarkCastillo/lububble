import { run } from "./docker.js";

export interface SnapshotResult {
  ok: boolean;
  detail: string;
}

export async function gitInit(projectDir: string): Promise<void> {
  await run("git", ["init", "-q"], { cwd: projectDir, timeoutMs: 30_000 });
}

export async function snapshot(projectDir: string, message: string, files?: string[]): Promise<SnapshotResult> {
  const addArgs = files?.length ? ["add", "--", ...files] : ["add", "-A"];
  const add = await run("git", [...addArgs], { cwd: projectDir, timeoutMs: 30_000 });
  if (add.code !== 0) return { ok: false, detail: add.text.slice(-300) };
  const commit = await run(
    "git",
    ["commit", "-q", "-m", message.slice(0, 300), "--allow-empty", "--no-gpg-sign"],
    { cwd: projectDir, timeoutMs: 30_000 },
  );
  if (commit.code !== 0) return { ok: false, detail: commit.text.slice(-300) };
  const hash = await run("git", ["rev-parse", "--short", "HEAD"], { cwd: projectDir, timeoutMs: 30_000 });
  return { ok: true, detail: `snapshot ${hash.text.trim()}` };
}

export interface HistoryEntry {
  hash: string;
  message: string;
  date: string;
}

export async function history(projectDir: string): Promise<HistoryEntry[]> {
  const { code, text } = await run(
    "git",
    ["log", "--pretty=format:%h\x1f%s\x1f%ad", "--date=iso"],
    { cwd: projectDir, timeoutMs: 30_000 },
  );
  if (code !== 0) return [];
  return text
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, message, date] = line.split("\x1f");
      return { hash, message, date };
    });
}

export async function restore(projectDir: string, hash: string, message: string): Promise<SnapshotResult> {
  if (!/^[a-fA-F0-9]{7,40}$/.test(hash)) throw new Error("invalid hash");
  const checkout = await run("git", ["checkout", hash, "--", "."], { cwd: projectDir, timeoutMs: 60_000 });
  if (checkout.code !== 0) return { ok: false, detail: checkout.text.slice(-300) };
  await run("git", ["add", "-A"], { cwd: projectDir, timeoutMs: 30_000 });
  return { ok: true, detail: `restored ${hash}` };
}
