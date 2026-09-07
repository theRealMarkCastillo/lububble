# Lububble — Safety & Behavioral Invariants

Each invariant must be enforced by code and covered by a named test. Breaking
an invariant without adding the test first (or in the same change) is forbidden.
Adopted from software-factory practice.

| ID | Invariant | Enforcement | Test |
|----|-----------|-------------|------|
| INV-1 | Compose is statically validated before any Docker command; validation failure starts zero containers | `mcp-tools/src/policy.ts` `validateComposeFiles` called in every compose tool | `policy.test.ts` |
| INV-2 | Compose manifests containing privileged, cap_add, devices, userns_mode, host namespaces, `container_name`, external networks, unconfined security_opt, or `restart: always` are rejected | policy.ts `assertServiceSafe` | policy.test.ts |
| INV-3 | Docker socket and sensitive-root mounts are always rejected; relative bind mounts must stay inside the project dir | policy.ts `checkBindSource` | policy.test.ts (socket, escape, inside-project) |
| INV-4 | Host ports only via the allocated `${APP_PORT:-...}` variable; no hardcoded publish | policy.ts ports check | policy.test.ts (hardcoded, APP_PORT accepted) |
| INV-5 | Compose project names are namespaced `lububble-{slug}`; teardown uses only its own `-p` | policy.ts `composeProjectName` | policy.test.ts |
| INV-6 | Any container change outside the `lububble-*` namespace observed across a compose op fails the run (default-deny) | snapshot.ts `diffSnapshots` + index.ts SAFETY marker | (live docker check in test-docker; unit pending) |
| INV-7 | Every sanctioned Docker op records a JSONL evidence record (tool, project, ok, exit, violations, foreign changes, duration) | evidence.ts `appendEvent` via `record()` | (unit pending) |
| INV-8 | Workspace file ops cannot escape `~/lububble-projects` (project sandbox) | index.ts `resolveScope` | test.ts (http_check unreachable path covered; unit pending) |
| INV-9 | Server file API rejects paths resolving outside the project dir | server/src/index.ts guard | server test (covered E2E) |
| INV-10 | Project names must start with a letter/number and contain only letters, numbers, spaces, `_`, `-`; names are rejected, never silently mutated | projects.ts `slugify` | server test (covered) |
| INV-11 | API keys are stored 0600 in `~/.lububble/config.json`, never returned unmasked through the API, never logged | config.ts | (unit pending) |
| INV-12 | Teardown is unconditional: compose op always attempts `down` even after a failed `up`, and foreign-change detection runs even on failure paths | index.ts `record()` + try/finally structure | (pending) |
| INV-13 | Project isolation boundary: **runtime** isolation is hard (per-project compose networks/volumes/ports, INV-1/4/5); **agent** fs boundary is VM-phase work (design = containerized hermes agent with project-dir-only mounts). Until then soft guards apply (cwd-pinned agents, per-project sessions, git snapshots, AGENTS.md scope) | docs/isolation.md | pending VM phase |

## Pending unit coverage (next batch)

INV-6, INV-7, INV-8 (unit level), INV-9, INV-11, INV-12. Rule: no invariant
stays "pending" after the feature that depends on it ships.
