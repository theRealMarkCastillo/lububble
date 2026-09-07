import { promises as fs } from "fs";
import path from "path";

export interface RunRecord {
  timestamp: string;
  tool: string;
  project: string;
  ok: boolean;
  exitCode: number | null;
  policyViolations: string[];
  foreignContainerChanges: string[];
  output: string;
  durationS: number;
}

const RUNS_DIR = path.join(process.env.HOME ?? process.env.USERPROFILE ?? ".", ".lububble", "runs");

export async function readManifest(project: string): Promise<RunRecord[]> {
  const file = path.join(RUNS_DIR, `${project}.jsonl`);
  try {
    const text = await fs.readFile(file, "utf8");
    return text
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunRecord);
  } catch {
    return [];
  }
}

export async function appendEvent(record: RunRecord): Promise<void> {
  await fs.mkdir(RUNS_DIR, { recursive: true });
  await fs.appendFile(path.join(RUNS_DIR, `${record.project}.jsonl`), `${JSON.stringify(record)}\n`, "utf8");
}
