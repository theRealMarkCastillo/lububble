# Lububble — Local-first AI App Builder

Lovable-style app builder that runs entirely on your machine. Describe an app in chat; an LLM
(any OpenAI-compatible endpoint) generates it; it runs locally via Docker Compose. "Publish" = a
pinned production compose stack.

## Architecture

```
┌────────────────────────────────────────────────────┐
│ Builder UI (web, localhost:5173)                    │
│  chat · preview iframe · code/logs/history · publish│
└──────────────┬─────────────────────────────────────┘
               │ HTTP/SSE
┌──────────────▼─────────────────────────────────────┐
│ Orchestrator (server, localhost:3001)               │
│  • project manager + workspace + git snapshots      │
│  • ACP client (drives any ACP-speaking agent)       │
│  • MCP tool server: files, docker, health, ports    │
│  • docker compose runner (dev/staging/prod stacks)  │
│  • preview proxy (iframe/CSP + script-inject hook)  │
└──────────────┬─────────────────────────────────────┘
               │ ACP (JSON-RPC, subprocess)
┌──────────────▼─────────────────────────────────────┐
│ Agent (Hermes first; any ACP agent)                 │
│  • owns agent loop + LLM calls                      │
│  • LLM = OpenAI-format endpoint/model/API key       │
│  • consumes Lububble MCP tools + skills             │
└─────────────────────────────────────────────────────┘
```

- **Agent contract**: ACP. Swap agents freely; orchestrator only speaks ACP.
- **Capability contract**: MCP tool pack (agent-agnostic, reusable by any future driver).

## Generated apps

- Default template: **Next.js + TypeScript + Tailwind/shadcn**
- Variants: `+ Postgres (Drizzle)` full, `+ SQLite` lite
- Agent edits the scaffolded template, never writes from scratch (reliability).

## Environment model

| Env | Purpose | Stack |
|---|---|---|
| `dev` | Agent iteration loop: patch → build → up → health-check → errors fed back (max N retries) | `compose.dev.yml`, ephemeral |
| `prod` | **Publish** = git tag + production compose stack, persistent volumes, own port, survives builder restart | `compose.prod.yml` |
| `staging` | Phase B (with drafts/promote flow): third named stack | `compose.staging.yml` |

- Ports: central JSON registry, per-project allocation, compose labels for cleanup.
- Context: only a persistent `context.md` file survives all phases.

## UI/UX (Lovable pattern, phased)

- **Phase A (MVP)**
  - Dashboard: project cards, "describe your app…" starter box, template gallery
  - Editor: chat-left (streaming, Stop, Undo-iteration, attach images) | preview iframe-right
    (desktop width, building overlay, refresh / hard-restart, idle pause → "Keep building")
  - Tabs: `Preview | Code | Logs | More` (More = services status, env/secrets, settings)
  - History drawer: auto-git versions (preview / restore / bookmark)
  - Publish → prod stack panel (containers, ports, health, Open, Stop)
  - Settings: LLM endpoint/model/key (multiple providers, per-project override)
  - Docker-not-running detection
- **Phase B**: device toggle (desktop/tablet/mobile), Drafts (git branch + second stack + port),
  staging env + promote flow, folders, command palette (Cmd+K)
- **Phase C**: preview toolbar (element select / annotate → prompt — proxy supports script injection
  from day one), Plan/Build modes, `/goal` runs, agent mid-run questions
- **Phase D**: open-in-IDE/terminal, compose export/share, remote deploy targets, health/uptime dashboard

## Build order

1. **Headless spike**: MCP tool pack + ACP agent end-to-end (prompt → file edits → build → health check)
2. Orchestrator: project CRUD, scaffolder, snapshotting, port alloc, docker runner (BuildKit caches,
   install/build split), secret storage (`~/.lububble/config.json`, chmod 600, bind 127.0.0.1)
3. Web UI shell: settings + streaming chat
4. Dev loop wiring (Phase A interactions)
5. Preview proxy (CSP/iframe handling + injectable script hook)
6. History/undo + Publish/prod stack
7+. Phases B–D

## Security & conventions

- Server binds `127.0.0.1` only; API keys stored chmod-600 local file, never logged
- Generated code executes locally by design (local tool)
- No comments in code; TypeScript strict
- Model context: file tree + relevant files + `context.md` per project (agent re-reads for state)
