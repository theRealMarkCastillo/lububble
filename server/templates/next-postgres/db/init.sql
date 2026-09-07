-- Lububble standard postgres profile: preinstalled extensions (SPEC-002).
-- Runs on every fresh volume of the db service (docker-entrypoint-initdb.d).
CREATE EXTENSION IF NOT EXISTS vector;      -- embeddings (pgvector)
CREATE EXTENSION IF NOT EXISTS pg_trgm;     -- fast fuzzy text search / autocomplete
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid, hashing
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- legacy uuid generation
CREATE EXTENSION IF NOT EXISTS unaccent;    -- accent-insensitive text matching
CREATE EXTENSION IF NOT EXISTS btree_gin;   -- composite/trgm index support
