# Lububble 🫧

Local-first AI app builder. Chat to build apps like Lovable — but everything runs on your
machine with Docker Compose. Any OpenAI-format LLM endpoint (URL + model + key), any
ACP-speaking agent. See [PLAN.md](./PLAN.md) for the full plan.

## Status

- [x] **Ticket 1 — headless spike**: MCP tool pack (`@lububble/mcp-tools`) validated end-to-end:
      file ops (workspace-sandboxed), `compose_up` (build+wait), `compose_logs`, `compose_down`,
      `http_check` — driven through a real MCP client against real Docker.
- [x] **Ticket 2 — orchestrator** (`@lububble/server`): project CRUD API, Next.js template
      scaffolder, port registry (dev/prod/staging), secret config (`~/.lububble/config.json`,
      chmod 600), file API (path-escape protected). Validated E2E: scaffold → compose build →
      healthy → serves on allocated port → delete (down + cleanup).
- [x] **Ticket 3 — ACP client**: `server/src/acp.ts` (ndjson JSON-RPC client: initialize, session/new with MCP servers, session/prompt, permission auto-allow) + `agent.ts` (provider-injected HERMES_HOME config, retry loop). E2E verified: agent edited code, compose_up via policy-gated tools, healthy, http_check 200 — 45s, 1 attempt.
- [ ] Ticket 4 — Web UI (chat, preview, history, publish)

## Layout

```
mcp-tools/   MCP tool pack (files, docker compose, health checks) — agent-agnostic
server/      Orchestrator: project manager, ACP client, docker runner, preview proxy
web/         Builder UI (React + Vite)
docs/
```

## Run

```sh
npm install
npm run build -w @lububble/mcp-tools
```

MCP workspace root defaults to `~/lububble-projects` (override with `LUBUBBLE_WORKSPACE_ROOT`).
