import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

const client = postgres(process.env.DATABASE_URL ?? "postgres://lububble:lububble@db:5432/app");

export const db = drizzle(client, { schema });

export type SqlExecutor = Parameters<typeof drizzle>[0];

export function getSql(): postgres.Sql<Record<string, unknown>> {
  return client;
}

export interface ClaimedJob {
  id: string;
  kind: string;
  payload: string;
  attempts: number;
  maxAttempts: number;
}

export async function enqueueJob(
  sql: postgres.Sql<Record<string, unknown>>,
  kind: string,
  payload: Record<string, unknown>,
  runAt?: Date,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    INSERT INTO jobs (kind, payload, run_at)
    VALUES (${kind}, ${JSON.stringify(payload)}::jsonb, ${runAt ?? new Date()})
    RETURNING id
  `;
  await sql`SELECT pg_notify('job_wake', ${rows[0]?.id ?? ""})`;
  return rows[0].id!;
}

export async function claimJob(
  sql: postgres.Sql<Record<string, unknown>>,
  workerId: string,
): Promise<ClaimedJob | undefined> {
  const rows = await sql<{ id: string; kind: string; payload: string; attempts: number; max_attempts: number }[]>`
    UPDATE jobs SET claimed_at = now(), claimed_by = ${workerId}
    WHERE id = (
      SELECT id FROM jobs
      WHERE claimed_at IS NULL AND run_at <= now()
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, kind, payload, attempts, max_attempts
  `;
  const row = rows[0];
  if (!row) return undefined;
  return { id: row.id, kind: row.kind, payload: row.payload, attempts: row.attempts, maxAttempts: row.max_attempts };
}

export async function completeJob(sql: postgres.Sql<Record<string, unknown>>, jobId: string): Promise<void> {
  await sql`DELETE FROM jobs WHERE id = ${jobId}`;
}

export async function failJob(
  sql: postgres.Sql<Record<string, unknown>>,
  jobId: string,
  attempts: number,
  maxAttempts: number,
  errorText: string,
): Promise<void> {
  if (attempts >= maxAttempts) {
    await sql`UPDATE jobs SET claimed_at = NULL, last_error = ${errorText.slice(0, 2000)} WHERE id = ${jobId}`;
    return;
  }
  const backoff = Math.min(120, 5 * attempts);
  await sql`
    UPDATE jobs
    SET claimed_at = NULL, attempts = attempts + 1, last_error = ${errorText.slice(0, 2000)},
        run_at = now() + make_interval(secs => ${backoff})
    WHERE id = ${jobId}
  `;
}
