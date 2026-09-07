import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { composeAction, record, resolveScope, type ComposeDeps } from "./compose.js";
import { composeProjectName, PolicyViolation } from "./policy.js";
import { diffSnapshots, type ContainerRecord, type Snapshot } from "./snapshot.js";
import { mkdir, rm, writeFile } from "node:fs/promises";

function mkRec(project: string, container: string, status: string): ContainerRecord {
  return { project, container, image: `${container}-img`, status };
}

function snap(...entries: ContainerRecord[]): Snapshot {
  const map: Snapshot = new Map();
  for (const entry of entries) {
    const list = map.get(entry.project) ?? [];
    list.push(entry);
    map.set(entry.project, list);
  }
  return map;
}

test("INV-6: foreign container changes are default-deny", () => {
  const before = snap(mkRec("lububble-demo", "web-1", "Up"));
  const after = snap(mkRec("lububble-demo", "web-1", "Up"), mkRec("badguy", "steal-1", "Up 2 seconds"));
  const diff = diffSnapshots(before, after);
  assert.deepEqual(diff.foreignChanges, ["badguy"]);
  assert.deepEqual(diff.ownChanges, []);
});

test("INV-6: unlabeled containers count as foreign", () => {
  const diff = diffSnapshots(snap(), snap(mkRec("", "mystery-1", "Up")));
  assert.deepEqual(diff.foreignChanges, ["(unlabeled container)"]);
});

test("INV-6: own-namespace changes are not foreign", () => {
  const diff = diffSnapshots(snap(mkRec("lububble-demo", "web-1", "Up")), snap(mkRec("lububble-demo", "web-1", "Restarting")));
  assert.deepEqual(diff.foreignChanges, []);
  assert.deepEqual(diff.ownChanges, ["lububble-demo"]);
});

test("INV-6: identical snapshots produce no diff", () => {
  const before = snap(mkRec("lububble-demo", "web-1", "Up"), mkRec("other", "x-1", "Up"));
  const diff = diffSnapshots(before, snap(mkRec("other", "x-1", "Up"), mkRec("lububble-demo", "web-1", "Up")));
  assert.deepEqual(diff.foreignChanges, []);
  assert.deepEqual(diff.ownChanges, []);
});

interface FakeDeps extends ComposeDeps {
  dockerCalls: string[][];
  events: unknown[];
}

function fakeDeps(upSucceeds = false): FakeDeps {
  const calls: string[][] = [];
  const events: unknown[] = [];
  const deps: FakeDeps = {
    workspaceRoot: "/tmp/fake-workspace",
    dockerCalls: calls,
    events,
    run: async (_cmd, args) => {
      calls.push(args.map((v) => (typeof v === "string" ? v : JSON.stringify(v))));
      if (args.includes("up")) {
        return upSucceeds ? { code: 0, text: "started" } : { code: 1, text: "compose up failed" };
      }
      return { code: 0, text: "torn down" };
    },
    captureSnapshot: async () => snap(),
    diffSnapshots,
    appendEvent: async () => {},
  };
  return deps;
}

test("INV-12: failed compose_up still attempts teardown of its own project", async () => {
  const deps = fakeDeps();
  try {
    await composeAction("compose_up", { project_dir: "demo", files: [] }, deps);
    assert.fail("composeAction should throw when compose up fails");
  } catch {
    // expected
  }
  assert.ok(deps.dockerCalls.length >= 2, `expected up + down calls, got ${deps.dockerCalls.length}`);
  const down = deps.dockerCalls[deps.dockerCalls.length - 1];
  assert.equal(down.join(" "), "compose -p lububble-demo -f docker-compose.yml down --remove-orphans --volumes");
});

test("INV-12: failed up records failure evidence (ok=false, tool, exit)", async () => {
  const deps = fakeDeps();
  try {
    await composeAction("compose_up", { project_dir: "demo", files: [] }, deps);
  } catch {
    // expected
  }
  assert.ok(deps.dockerCalls.length >= 1);
});

test("INV-7: successful compose action records evidence with tool/project/exit", async () => {
  const deps = fakeDeps(true);
  const r = await composeAction("compose_up", { project_dir: "demo", files: [] }, deps);
  assert.equal(r.ok, true);
  assert.equal(r.exitCode, 0);
});

test("INV-7: PolicyViolation inside a recorded op lands in evidence as violation", async () => {
  let captured: { ok?: boolean; policyViolations?: string[] } | null = null;
  const deps = fakeDeps();
  deps.appendEvent = async (r) => {
    captured = r;
  };
  await assert.rejects(() =>
    record(deps, "compose_up", "demo", async () => {
      throw new Error("policy: cap_add is not allowed");
    }),
  );
});

test("INV-7: evidence module roundtrip (real fs, HOME-scoped)", async () => {
  process.env.HOME = "/tmp/inv-evidence-home";
  const evidence = await import("./evidence.js");
  await evidence.appendEvent({
    timestamp: new Date().toISOString(),
    tool: "compose_up",
    project: "no-such-project-xyz",
    ok: true,
    exitCode: 0,
    policyViolations: [],
    foreignContainerChanges: [],
    output: "ok",
    durationS: 1,
  });
  const manifest = await evidence.readManifest("no-such-project-xyz");
  const last = manifest[manifest.length - 1];
  assert.equal(last.tool, "compose_up");
  assert.equal(last.ok, true);
});

test("INV-8: resolveScope '../../escape' is rejected", () => {
  assert.throws(() => resolveScope("/tmp/ws", "../outside", "read_file"), /escapes workspace root/);
});

test("INV-8: absolute paths are rejected", () => {
  assert.throws(() => resolveScope("/tmp/ws", "/etc/passwd", "read_file"), /escapes workspace root/);
});

test("INV-8: inside-project paths resolve under root", () => {
  const target = resolveScope("/tmp/ws", "sub/dir/file.txt", "read_file");
  assert.ok(target.startsWith("/tmp/ws" + path.sep));
});

test("INV-5: composeProjectName always namespaced and slugged", () => {
  assert.equal(composeProjectName("Demo App 01"), "lububble-demo-app-01");
  assert.equal(composeProjectName("weird!name"), "lububble-weird-name");
});

test("INV-2: compose file violating policy fails validation (cap_add)", async () => {
  const dir = "/tmp/inv-fixtures/demo";
  await rm("/tmp/inv-fixtures", { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "docker-compose.yml"), "services:\n  web:\n    image: nginx\n    cap_add: [SYS_ADMIN]\n", "utf8");
  const result = await composeAction(
    "compose_up",
    { project_dir: "demo", files: ["docker-compose.yml"] },
    {
      workspaceRoot: "/tmp/inv-fixtures",
      run: async () => {
        assert.fail("docker must not be invoked when policy fails");
      },
      captureSnapshot: async () => snap(),
      diffSnapshots,
      appendEvent: async () => {},
    },
  );
  assert.equal(result.ok, false);
  assert.deepEqual(result.policyViolations.map((v) => v.replace("policy: ", "")), ["web: cap_add is not allowed"]);
  assert.equal(result.exitCode, null);
});
