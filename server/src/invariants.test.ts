process.env.HOME = "/tmp/lububble-inv-home";

import assert from "node:assert/strict";
import test from "node:test";
import { rm, mkdir, stat, readFile } from "node:fs/promises";

const SCRATCH_HOME = "/tmp/lububble-inv-home";

test("INV-9/10/11: server guards, name policy, and key redaction", async (t) => {
  await rm(SCRATCH_HOME, { recursive: true, force: true });
  await mkdir(SCRATCH_HOME, { recursive: true });
  process.env.HOME = SCRATCH_HOME;

  const { createApp } = await import("./index.js");
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const created = (await (await fetch(`${base}/api/projects`, post({ name: "Sci Project" }))).json()) as { project: { id: string } };
  assert.equal(created.project.id, "sci-project");

  const bad = await fetch(`${base}/api/projects`, post({ name: "_leading" }));
  assert.equal(bad.status, 400);

  for (const rel of ["../../etc/hosts", "/etc/passwd", "..", "sub/../../out", "/root/.ssh/id_rsa"] as const) {
    const r1 = await fetch(`${base}/api/projects/sci-project/file?path=${encodeURIComponent(rel)}`);
    assert.equal(r1.status, 400, `GET must reject escape: ${rel}`);
    const r2 = await fetch(`${base}/api/projects/sci-project/file?path=${encodeURIComponent(rel)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "hi" }),
    });
    assert.equal(r2.status, 400, `PUT must reject escape: ${rel}`);
  }

  assert.equal((await (await fetch(`${base}/api/projects/sci-project/uploads/..%2F..%2Fetc%2Fhosts`)).status), 400, "uploads traversal must be rejected");

  const key = "sk-secret-abcdef-9999";
  const put = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      config: {
        providers: [{ id: "p1", name: "prov", baseUrl: "http://localhost:8080/v1", model: "m", apiKey: key }],
        defaultProviderId: "p1",
      },
    }),
  });
  assert.ok(put.ok);

  const raw = JSON.parse(await readFile(`${SCRATCH_HOME}/.lububble/config.json`, "utf8")) as { providers: { apiKey: string }[] };
  assert.equal(raw.providers[0].apiKey, key, "file holds the real key (encrypted-at-rest is out of scope)");

  const fileStat = await stat(`${SCRATCH_HOME}/.lububble/config.json`);
  assert.equal(fileStat.mode & 0o777, 0o600, "config.json must be 0600");

  const listed = (await (await fetch(`${base}/api/config`)).json()) as { config: { providers: { apiKey: string }[] } };
  const masked = listed.config.providers[0].apiKey;
  assert.ok(masked.includes("••••••••9999"), `masked: ${masked}`);
  assert.ok(!masked.includes(key));

  const echoed = await fetch(`${base}/api/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: { providers: [{ id: "p1", name: "prov", baseUrl: "http://localhost:8080/v1", model: "m", apiKey: masked }], defaultProviderId: "p1" } }),
  });
  assert.ok(echoed.ok);
  const afterEcho = JSON.parse(await readFile(`${SCRATCH_HOME}/.lububble/config.json`, "utf8")) as { providers: { apiKey: string }[] };
  assert.equal(afterEcho.providers[0].apiKey, key, "submitting the masked value must keep the stored key");
});
