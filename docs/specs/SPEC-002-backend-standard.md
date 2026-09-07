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
| `postgres` (default full) | web + pgvector/pgvector:pg17 | anything with users/data |
| `postgres+redis` (**escalation**) | web + postgres + redis:7 | explicit escalation only |

**Redis is NOT in the default stack.** Queues, cache, pub/sub and
rate-limiting are Postgres-native (see "Data plane standards"). Redis is
added only when the app genuinely needs out-of-process serialization
(fan-out at scale, external workers) — that is a spec change, not a
per-project habit (2019-era default).

## Data plane standards (Postgres-native replacements for the "usual infra")

| Concern | Standard implementation |
|---|---|
| Background jobs | `jobs` table: `SELECT ... FOR UPDATE SKIP LOCKED` claim loop in an app-level worker + `pg_notify()` to wake claimers instantly. LLM guidance: idempotent job functions, `attempts`/`max_attempts`, `run_at`, claimed_by/claimed_at. Do NOT reach for Celery/BullMQ. |
| Scheduled work | Long-running node loop / `setInterval` worker in the web container bootstrapping from `jobs WHERE run_at <= now()`; `pg_cron` only via escalation (not in base image) |
| Pub/Sub (live updates) | `pg_notify()/LISTEN` bridged through the app to SSE via Next.js route handlers |
| Rate limiting | counters table upsert (`rate_limit_counter`), no Redis |
| App cache | materialized views for read models (`REFRESH` on a job); memoization container pass |
| Embeddings / semantic search | `vector` + HNSW (`vector_cosine_ops`) |
| Structured semantic graph (SPO triples) | `triples(subject, predicate, object)` with trgm indexes over s/p/o (via pg_trgm `%`/`similarity()`) for consumers; `vector` index over object embedding for hard matches; store p as a controlled vocabulary (text enum table) not free text |
| Full text search | Postgres FTS (`tsv`) + trgm for suggestions; no OpenSearch |

These "one boring engine covers the data plane" choices are what keep the
generated apps reviewable and lean like you asked. They also match the
actual post-Supabase trend (oneshot pgmq-style queues), so both standard
and skill guidance for generated apps stay portable.

## Storage and reference semantic SPO index (normative-prompt context)

The agent MUST use trigram indexes for subject/predicate/object similarity
match queries (GIN over lower/normalized columns), not raw `ILIKE` alone.

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
