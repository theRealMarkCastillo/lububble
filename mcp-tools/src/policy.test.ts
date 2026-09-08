import assert from "node:assert/strict";
import test from "node:test";
import { PolicyViolation, assertSafeComposeFile, composeProjectName } from "./policy.js";

test("compose rejects privileged", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { privileged: true } } }), PolicyViolation);
});

test("compose rejects cap_add", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { cap_add: ["SYS_ADMIN"] } } }), PolicyViolation);
});

test("compose rejects devices", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { devices: ["/dev/sda:/dev/sda"] } } }), PolicyViolation);
});

test("compose rejects userns_mode", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { userns_mode: "host" } } }), PolicyViolation);
});

test("compose rejects host network_mode", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { network_mode: "host" } } }), PolicyViolation);
});

test("compose rejects docker socket mount", () => {
  assert.throws(
    () => assertSafeComposeFile({ services: { app: { volumes: ["/var/run/docker.sock:/var/run/docker.sock"] } } }, "."),
    PolicyViolation,
  );
});

test("compose rejects long-form bind mounts outside the project", () => {
  assert.throws(
    () => assertSafeComposeFile({ services: { app: { volumes: [{ type: "bind", source: "/etc", target: "/host" }] } } }, "/proj/app"),
    PolicyViolation,
  );
});

test("compose rejects escape mount", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { volumes: ["../../etc:/host"] } } }, "/proj/app"), PolicyViolation);
});

test("compose accepts mount inside project", () => {
  assert.doesNotThrow(() => assertSafeComposeFile({ services: { app: { volumes: ["./data:/app"] } } }, "/proj/app"));
});

test("compose rejects external network", () => {
  assert.throws(() => assertSafeComposeFile({ networks: { shared: { external: true } } }), PolicyViolation);
});

test("compose rejects container_name", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { container_name: "web" } } }), PolicyViolation);
});

test("compose rejects restart always", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { restart: "always" } } }), PolicyViolation);
});

test("compose rejects unconfined security_opt", () => {
  for (const opt of ["seccomp:unconfined", "apparmor:unconfined", "label:disable"]) {
    assert.throws(() => assertSafeComposeFile({ services: { app: { security_opt: [opt] } } }), PolicyViolation);
  }
});

test("compose rejects hardcoded host ports", () => {
  assert.throws(() => assertSafeComposeFile({ services: { app: { ports: ["8080:3000"] } } }), PolicyViolation);
});

test("compose accepts APP_PORT variable ports", () => {
  assert.doesNotThrow(() => assertSafeComposeFile({ services: { app: { ports: ["${APP_PORT:-3000}:3000"] } } }));
});

test("compose accepts safe config", () => {
  assert.doesNotThrow(() => assertSafeComposeFile({ services: { app: { image: "node:22-alpine", restart: "unless-stopped" } } }));
});

test("compose project names are namespaced and safe", () => {
  assert.equal(composeProjectName("_docker-test"), "lububble-docker-test");
  assert.equal(composeProjectName("Demo App 01"), "lububble-demo-app-01");
  assert.match(composeProjectName("x"), /^lububble-[a-z0-9]/);
});
