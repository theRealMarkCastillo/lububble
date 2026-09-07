# Lububble — Project Isolation Model

Answers: "can one project's agent touch another project's files?" — and what
guarantees exist vs what the VM phase must add.

## Current guarantees (hard)

| Layer | Guarantee | Mechanism |
|---|---|---|
| Runtime | Each generated app is fully isolated at runtime | Per-project compose project (`lububble-<id>`, `lububble-<id>-prod`) → own bridge network, own named volumes, service-name DNS. No cross-project networks (INV: external networks banned). Verified live: one `*_default` network per project. |
| Runtime ports | Only `web` publishes a host port (its allocated `${APP_PORT}`); db/cache never publish | policy.ts port check (INV-4) |
| Runtime teardown | A project only ever tears down its own `-p` | compose `-p` namespacing + banned-command fragments (INV-5) |
| Version control | One git repo per project; per-iteration snapshots | scaffolder `gitInit`, snapshot/restore (INV: every project = its own repo) |

## Current gaps (soft — agent-side)

The agent (hermes acp) runs natively on the host (later: VM) with `cwd`
pinned to `~/lububble-projects/<id>`, but its fs/terminal tools can reach
**anything that OS user can reach**. Concretely: a misbehaving agent could
write into another project's dir, or into the builder repo. Mitigations in
place today (soft):
- one pooled agent process per project, spawned with cwd = that project;
  session memory never crosses projects (different sessions)
- per-project git snapshots bound the blast radius per iteration and
  record exactly what changed
- per-project AGENTS.md carries scope conventions ("only edit inside this
  directory; do not touch other projects or the builder")

## VM target model (to implement when de-sandboxing matters)

Pick one of (in order of preference for a VM deployment):

1. **Containerized agent per project (recommended)** — spawn `hermes acp`
   inside a container with ONLY the project dir bind-mounted read-write
   (and no docker socket, no other mounts). The orchestrator talks to it
   over ACP adjusted for the container transport. Same protocol, hard
   boundary. Per-project, no new user management.
2. **Per-project OS user / sandbox** — each project's agent process runs
   as its own user with HOME set to the project dir (bubblewrap/firejail/
   sandbox-exec profile). Pairs with a per-project upstream git remote.
3. **One VM per project** — strongest, heaviest; only if multitenancy
   (untrusted users) arrives.

## Related file-isolation guards already enforced by the server

- Builder file API: path escapes project dir are rejected (INV-9).
- MCP tool pack (when used): workspace-root sandbox + escape checks (INV-8).

## Decision recorded

2026-09-07: ship local-tool with native hermes tools (fast, usable);
project isolation is a VM-phase requirement, design chosen is option 1
(containerized agent, project-dir-only mounts). Revisit before any
multi-tenant/port-facing deployment.
