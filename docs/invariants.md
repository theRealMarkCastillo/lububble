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
| INV-6 | Any container change outside the `lububble-*` namespace observed across a compose op fails the run (default-deny) | compose.ts `diffSnapshots` wiring | invariants.test.ts (synthetic snapshots: foreign, unlabeled, own, no-diff) |
| INV-7 | Every sanctioned Docker op records a JSONL evidence record (tool, project, ok, exit, violations, foreign changes, duration) — including failures | compose.ts `record()` | invariants.test.ts (roundtrip + failure-path evidence) |
| INV-8 | Workspace file ops cannot escape `~/lububble-projects` (project sandbox) | compose.ts `resolveScope` | invariants.test.ts (relative, absolute, inside paths) |
| INV-9 | Server file API rejects paths resolving outside the project dir | server/src/index.ts guard | server/invariants.test.ts (GET+PUT escapes, uploads traversal) |
| INV-10 | Project names must start with a letter/number and contain only letters, numbers, spaces, `_`, `-`; names are rejected, never silently mutated | projects.ts `slugify` | server/invariants.test.ts (reject `_bad`) |
| INV-11 | API keys are stored 0600 in `~/.lububble/config.json`, never returned unmasked through the API, never logged | config.ts | server/invariants.test.ts (chmod 0600, masked response, masked-echo keeps stored key) |
| INV-12 | Teardown is unconditional: compose op always attempts `down` even after a failed `up` (including nonzero exit and thrown paths), and foreign-change detection runs even on failure paths | compose.ts `composeAction` | invariants.test.ts (teardown call asserted on failed up) |
| INV-13 | Project isolation boundary: **runtime** isolation is hard (per-project compose networks/volumes/ports, INV-1/4/5); **agent** fs boundary is VM-phase work (design = containerized hermes agent with project-dir-only mounts). Until then soft guards apply (cwd-pinned agents, per-project sessions, git snapshots, AGENTS.md scope rules, boot-time orphan compose sweep so unregistered `lububble-*` stacks can't squat ports) | docs/isolation.md | pending VM phase (sweep + rules shipped 2026-09-07) |

## Pending unit coverage (next batch)

INV-13 (containerized-agent boundary — VM phase, by design). All other
invariants have enforcing code + named unit tests. Rule: no invariant stays
"pending" after the feature that depends on it ships.
