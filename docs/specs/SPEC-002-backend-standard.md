# Lububble — Backend Standard (SPEC-002)

Status: draft · Applies to all generated apps.

## Goal

Every Lububble-generated app has a **standard, lean, local backend** owned by its
own Docker Compose stack — the local equivalent of Lovable's Supabase
integration. One `compose up` owns the app and its backend; teardown removes it.

## Backend profiles (chosen at project creation)

| Profile | Services | Use when |
|---|---|---|
| `sqlite` | web only (SQLite file in a mount) | tiny apps, CRUD-lite |
| `postgres` (default full) | web + postgres:17-alpine | anything with users/data |
| `postgres+redis` | web + postgres + redis:7-alpine | jobs, caching, rate limits |

## Conventions (normative)

1. **Profile services live in the project's compose file** — never shared
   across projects, never host-installed. Volumes are compose-managed;
   teardown (`down --volumes`) is safe.
2. **Connection env names are fixed**: `DATABASE_URL`
   (`postgres://lububble:lububble@db:5432/app` in compose network;
   host-dbg via the published port is NOT exposed by default), `REDIS_URL`
   (`redis://cache:6379`). The agent must never invent other names.
3. **ORM standard: Drizzle** (`drizzle-orm` + `drizzle-kit`), schema in
   `db/schema.ts`, migrations in `db/migrations/` applied by
   `drizzle-kit migrate` at container start. Rejected: Prisma (heavier,
   engine binary), raw SQL through the agent (no migration trail).
4. **Auth standard: Better Auth** mounted in the Next.js app (sessions in
   Postgres) when the app needs users. No separate auth container.
5. **Storage standard**: file uploads write to the web container's
   `.data/` volume via app code; expose only app endpoints. MinIO/S3 is
   an explicit escalation (not in the default profiles).
6. **DB access policy**: the `lububble-tools` MCP suite may add
   `db_query` (read-only SQL against the project's postgres service over
   the compose network). No host port publication for the DB, ever
   (matches software-factory default-deny ports policy).
7. **The agent is forbidden** from adding new backend services with
   `docker run` or random containers; anything beyond the profile
   requires the user to pick/extend the profile.

## Port allocation

Only `web` publishes a host port (the allocated `${APP_PORT:-...}`).
Internal services talk over the compose network by service name
(`db:5432`, `cache:6379`) — factory-style zero-collision isolation.

## Postgres extension standard

Base image: `pgvector/pgvector:pg17` (postgres 17 + pgvector binaries).
Extensions are standardized: the `db/init.sql` entrypoint script creates
the fixed set below on every fresh volume. The agent may `USE` any of
these but must not introduce NEW extension dependencies — adding one
requires updating this spec and the template (fail loud, not drift).

| Extension | Allowed uses |
|---|---|
| `vector` (pgvector) | embeddings for AI features (`vector(1536)` etc., HNSW index) |
| `pg_trgm` | fuzzy search, autocomplete, trgm GIN indexes |
| `pgcrypto` | `gen_random_uuid()`, digests |
| `"uuid-ossp"` | legacy `uuid_generate_v4()` |
| `unaccent` | accent-insensitive matching |
| `btree_gin` | composite GIN indexes (trgm+data combos) |

Explicitly NOT preinstalled (banned-by-default): postgis, timescale, citus,
plpython, pg_stat_statements. Rationale: stay lean and boring; add only
with a spec change.

Prompt/skill guidance to the agent MUST include:
- chunk embeddings → store as `vector(N)` columns, index with HNSW
  (`CREATE INDEX ... USING hnsw (col vector_cosine_ops)`),
- search → `ILIKE` + `similarity() %` from pg_trgm for autosuggest.

## Roadmap mapping

- "Services" tab in the More pane = compose service status + DB table
  browser (via `db_query` MCP tool) + env editor writing `.env`.
- Publish uses the same profile; prod compose variant of the profile.
