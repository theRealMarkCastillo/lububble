# Lububble — SPEC-001: Architecture & Milestones

Status: draft · Supersedes: PLAN.md (kept as plan narrative; this is the normative spec).

## Product

Local-first AI app builder. Chat to build Next.js/TypeScript apps; any
OpenAI-compatible LLM endpoint (URL/model/key); any ACP-speaking agent; runs
and "publishes" via Docker Compose on the local machine.

## Components (normative names)

- `@lububble/mcp-tools` — MCP server exposing the sanctioned capability surface:
  workspace file ops, compose lifecycle (`compose_up|down|logs`), `http_check`,
  `run_history`. All Docker behavior is gated by `policy.ts` and protected by
  `snapshot.ts` (default-deny foreign-container diff) and `evidence.ts`
  (JSONL manifests in `~/.lububble/runs/`). NOTE (2026-09-07): the agent no
  longer attaches this MCP server (`mcpServers: []`); the pack remains the
  sanctioned surface for headless/factory-scale agents (kanban workers) and
  its policy/evidence code is also reused server-side.
- `@lububble/server` — orchestrator HTTP API: project CRUD/scaffold, port
  registry, config/secrets (`~/.lububble/config.json`, 0600), file API,
  (later) ACP client and preview proxy.
- `web` — builder UI.

## Environments

| env | compose files | notes |
|---|---|---|
| dev | docker-compose.yml | agent iteration loop; ephemeral |
| prod | docker-compose.prod.yml | publish = git tag + pinned stack, persistent volumes |
| staging | (Phase B) | named stack in the same registry |

Ports are allocated from ranges and recorded in `~/.lububble/ports.json`;
published host ports must use the `${APP_PORT:-...}` variable.

## Acceptance criteria per milestone

### M1 — tool pack (done)
- [x] compose_up with `--wait` reaches Healthy and serves HTTP 200 on the allocated port
- [x] unsafe compose (privileged, socket mount, escape mounts, hardcoded ports, external nets) is rejected pre-Docker with zero containers started
- [x] every compose op leaves a JSONL evidence record (tool, exit, violations, foreign container changes, duration)
- [x] policy test suite passes (node --test)

### M2 — orchestrator (done)
- [x] POST /api/projects scaffolds template; invalid names rejected (no mutation)
- [x] file API rejects path escape (`../../`), confirms on write+read-back
- [x] delete performs compose down + dir removal + port release; unknown ids handled without registry mutation
- [x] **ACP loop (done, card t_b3c38bd8; updated 2026-09-07)**: `server/src/acp.ts` — ndjson
  JSON-RPC over stdio (`initialize` → `session/new` with `mcpServers: []` → `session/prompt`;
  permission requests auto-resolved to allow; fs/terminal client methods refused).
  The MCP bridge was removed from the agent path — Hermes acts natively on the project
  workspace (fs + terminal, cwd-pinned). `agent.ts` ensures the agent runs as Hermes's own
  `lububble` profile (`hermes profile create lububble --clone`, idempotent via profile-home
  marker; `HERMES_HOME` = the profile dir) so tuning stays in Hermes tooling and the user's
  own default profile is never mutated. Provider overrides from `PUT /api/config` merge into
  the profile `config.yaml` (custom provider: `base_url` + `key_env: LUBUBBLE_API_KEY`) and the
  profile `.env` (0600) on every spawn; pooled agents are killed on provider change. Chat
  history is restored on project open via `session/list` + `session/load` — Hermes's persisted
  session store is the source of truth (server holds an in-memory mirror only). Retry loop
  feeds errors back (MAX_ITERATIONS=3).
  **Connection model (fixed):** one long-lived `hermes acp` process per project
  (pool in `agent.ts`), one session per project reused across turns — prompt
  turns are `session/prompt` into the same session, so no per-turn agent boot
  and full conversational memory within a project. Pool processes are killed
  on project delete and by an idle sweeper (10 min).
  Verified E2E: prompt → file edit → compose_up (policy+snapshot+evidence path) → healthy →
  http_check 200, 1 attempt, 45s. VPN known shapes: ACP update payloads nest
  `sessionUpdate` under `params.update`. Pool persistence verified: two consecutive
  prompts hit the same Hermes PID and the second recalled the first's answer
  from session memory without re-reading files.

### M3 — builder UI
- chat with streaming + Stop + Undo-iteration; preview iframe on proxied port with building overlay; `Preview | Code | Logs | More` tabs; History drawer (git snapshot per iteration); Publish = prod stack panel; LLM settings screen; Docker-not-running detection.

## Non-goals (M1–M3)

- Multi-user auth, cloud deploy, payments, analytics. Local single-user only.
- Generated apps other than the Next.js template family.

## Conformance

Every milestone claims must cite evidence: commands run, test output, JSONL
run records. Missing/inconclusive evidence ⇒ INCONCLUSIVE, not PASS.
