import assert from "node:assert/strict";
import { mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { resolveProjectPath } from "./paths.js";

test("project paths cannot escape through a symlink", async () => {
  const root = "/tmp/lububble-project-path";
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "project"), { recursive: true });
  await mkdir(path.join(root, "outside"), { recursive: true });
  await symlink(path.join(root, "outside"), path.join(root, "project", "linked"));
  await assert.rejects(() => resolveProjectPath(path.join(root, "project"), "linked/secret.txt", "read_file"), /symlink/);
});
