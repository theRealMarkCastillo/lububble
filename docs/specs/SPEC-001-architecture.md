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
  (JSONL manifests in `~/.lububble/runs/`).
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

### M2 — orchestrator (done, extend for ACP)
- [x] POST /api/projects scaffolds template; invalid names rejected (no mutation)
- [x] file API rejects path escape (`../../`), confirms on write+read-back
- [x] delete performs compose down + dir removal + port release; unknown ids handled without registry mutation
- [ ] ACP client drives an ACP agent (Hermes) with provider config injected; agent can call every MCP tool (loop: prompt → edits → build → healthy → error feedback on failure, max N retries)

### M3 — builder UI
- chat with streaming + Stop + Undo-iteration; preview iframe on proxied port with building overlay; `Preview | Code | Logs | More` tabs; History drawer (git snapshot per iteration); Publish = prod stack panel; LLM settings screen; Docker-not-running detection.

## Non-goals (M1–M3)

- Multi-user auth, cloud deploy, payments, analytics. Local single-user only.
- Generated apps other than the Next.js template family.

## Conformance

Every milestone claims must cite evidence: commands run, test output, JSONL
run records. Missing/inconclusive evidence ⇒ INCONCLUSIVE, not PASS.
