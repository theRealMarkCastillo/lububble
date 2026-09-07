import { run } from "./run.js";

export interface ContainerRecord {
  project: string;
  container: string;
  image: string;
  status: string;
}

export type Snapshot = Map<string, ContainerRecord[]>;

export const OWN_PROJECT_PREFIX = "lububble-";

export async function captureSnapshot(): Promise<Snapshot> {
  const { text } = await run(
    "docker",
    [
      "ps",
      "-a",
      "--format",
      "{{.Label \"com.docker.compose.project\"}}\t{{.Names}}\t{{.Image}}\t{{.Status}}",
    ],
    { timeoutMs: 30_000 },
  );
  const map: Snapshot = new Map();
  for (const line of text.trim().split("\n")) {
    if (!line) continue;
    const [project = "", container = "", image = "", status = ""] = line.split("\t");
    if (!container) continue;
    const list = map.get(project) ?? [];
    list.push({ project, container, image, status });
    map.set(project, list);
  }
  return map;
}

function signatures(snapshot: Snapshot): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [project, recs] of snapshot) {
    out.set(project, new Set(recs.map((r) => `${r.container}|${r.image}|${r.status}`)));
  }
  return out;
}

export interface SnapshotDiff {
  foreignChanges: string[];
  ownChanges: string[];
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const b = signatures(before);
  const a = signatures(after);
  const foreignChanges: string[] = [];
  const ownChanges: string[] = [];
  const keys = new Set([...b.keys(), ...a.keys()]);
  for (const key of keys) {
    const beforeSet = b.get(key) ?? new Set<string>();
    const afterSet = a.get(key) ?? new Set<string>();
    if (sameSet(beforeSet, afterSet)) continue;
    if (key.startsWith(OWN_PROJECT_PREFIX)) ownChanges.push(key);
    else foreignChanges.push(key || "(unlabeled container)");
  }
  return { foreignChanges, ownChanges };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
