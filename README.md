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
- [x] **Ticket 4 — UI phase A** (`web/`): dashboard, editor (chat with SSE streaming, preview iframe proxy, Code/Logs/History/More tabs), LLM provider settings (isolated Hermes injection), Publish panel (git snapshot + prod compose stack). Verified live: SSE-driven agent loop built & verified an app through the browser; prod stack serves on its own port.
- [x] **Tickets 5+ — chat hardening & ops (2026-09-07)**: history restore from Hermes's own
      session store (`session/list`+`session/load`, no disk mirror), user file/image uploads
      (NTIA-safe: sanitized `.uploads/`, ACP image blocks), publish self-heal + verified-URL
      banner, boot-time orphan compose sweep, port-conflict rules in generated projects'
      AGENTS.md, unit coverage for INV-6/7/8/9/10/11/12 (32 tests green), Code-pane save fix.
      Verified end-to-end by scripted API drive + manual pass.
- [ ] Ticket 5 — Phase B/C UX: device toggle, drafts, preview-edit toolbar (element select/annotate), /goal runs, Plan mode
- [ ] In-VM agent E2E (provider key settable outside VM — live; needs a working API key provider)

## Run it

```sh
npm install
npm run build -w @lububble/mcp-tools -w @lububble/server
node server/dist/main.js &        # orchestrator on 127.0.0.1:3001
cd web && npx vite                # UI on http://localhost:5173
```

The agent runs as the `lububble` Hermes profile (created on first spawn via
`hermes profile create lububble --clone`, HERMES_HOME pointed at the profile) and
acts natively on the project workspace — no MCP bridge in the agent path. Set
the LLM provider at runtime from outside via `PUT /api/config` (see
`scripts/install-orb-vm.sh` for the headless VM variant).

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
