# Lububble — Hosting & Remote Deployment (roadmap, SPEC-002 extension)

Local apps publish to a local prod stack today. When the user wants a real
public home for the app, the builder's pitch stays the same: **it's already a
docker compose stack — hand it to anything that accepts one.**

## The stack is the artifact

Every Lububble project already ships:
- `Dockerfile` + `docker-compose.yml` (profile-consistent: web + [db [+ redis]])
- `docker-compose.prod.yml` (pinned publish target with `restart: unless-stopped`)
- `.env` (APP_PORT + DATABASE_URL; secrets managed by the env editor, never
  in LLM context)
- A git repo with per-iteration history

So "deploy to the cloud" = ship those files + run `docker compose -p ... -f
docker-compose.prod.yml up -d`. No rewriting, no "adapt to platform X" step —
that is the entire pitch vs locked-in PaaS (and the reason to keep backend
lean: the stack must stay boring and portable).

## Supported targets (by effort)

1. **Any VPS with Docker (the honest baseline)** — `ssh`/`rsync` the project
   dir (compose files + .env) to the host, `docker compose -p <name> -f
   docker-compose.prod.yml up -d --build --wait`, then expose :80/:443 via the
   user's reverse proxy (Caddy/Traefik recommended; Caddy auto-HTTPS pairs
   well with the same stack). One command in the builder: "Publish → remote
   host". Secrets: `.env` only; never baked into images.
2. **Coolify / Dokploy VMs** — paste compose + env into their UI; same
   artifact, they manage TLS/SSL/renewal and routing. Good for
   not-running-your-own-reverse-proxy.
3. **Managed container platforms** (Fly.io, Railway, Render, Cloud Run):
   works when the app is stateless-ish — builders should ask the agent for
   the "deployable variant" (DB as managed service or bundled—📌
   provider-specific). Smoke-test with `compose --wait` before push.
4. **Swarm/K8s** — out of scope until asked; compose file is still the source
   (compose spec converts).

## Builder-side flow (roadmap ticket: "Publish → remote target")

- Settings: named remote targets (SSH host/path or provider token).
- Publish dialog: pick target → orchestrator rsyncs `docker-compose.prod.yml`
  + `Dockerfile` + app source + `.env` (never `.env.example` hallucinated by
  an agent — read from the project dir), runs the prod compose remotely,
  health-checks the public URL, reports `published → <url>` plus the exact
  commands run (evidence).
- Remote deploys get their own evidence record (`publish_remote`) with exit
  codes and the URL; unpublish = compose down on the target.

## Security notes (normative)

- Never bake secrets into images; keep `.env` out of git (already ignored)
  but DO ship it to the deploy target — same guardrails as local publish,
  delivered over SSH/SFTP only.
- TLS/reverse proxy is the hosting layer's job; the builder never starts a
  certbot in the generated app.
- Public URL vs local-only visibility remains the user's explicit choice
  (the "workload only / public web" publish split from Lovable maps to
  dev/prod vs remote here).
