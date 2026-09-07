import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PolicyViolation, validateComposeFiles } from "./policy.js";

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "compose");

const safeFixtures = ["safe-minimal.yml", "safe-hardened.yml"];
const unsafeFixtures = [
  "unsafe-privileged.yml",
  "unsafe-docker-socket.yml",
  "unsafe-escape-mount.yml",
  "unsafe-hardcoded-port.yml",
];

test("safe fixtures pass compose policy", async () => {
  for (const f of safeFixtures) {
    await assert.doesNotReject(() => validateComposeFiles(fixturesDir, [f]), `${f} should be accepted`);
  }
});

test("unsafe fixtures fail compose policy without running Docker", async () => {
  for (const f of unsafeFixtures) {
    await assert.rejects(
      () => validateComposeFiles(fixturesDir, [f]),
      (e: unknown) => e instanceof PolicyViolation,
      `${f} should be rejected`,
    );
  }
});
