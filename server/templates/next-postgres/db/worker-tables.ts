import postgres from "postgres";
export async function ensureJobsTable(client: postgres.Sql): Promise<void> {
  await client`
    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      kind text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      run_at timestamptz NOT NULL DEFAULT now(),
      attempts int NOT NULL DEFAULT 0,
      max_attempts int NOT NULL DEFAULT 3,
      claimed_at timestamptz,
      claimed_by text,
      last_error text
    )
  `;
}
