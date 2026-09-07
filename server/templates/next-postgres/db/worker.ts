import postgres from "postgres";
import { claimJob, completeJob, failJob, getSql } from "./jobs";
import { ensureJobsTable as ensureTable } from "./worker-tables";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;

const HANDLERS: Record<string, JobHandler> = {};

export function registerHandler(kind: string, handler: JobHandler): void {
  HANDLERS[kind] = handler;
}

const workerId = `worker-${process.pid}-${Math.random().toString(36).slice(2, 7)}`;

export async function ensureJobsTable(client: postgres.Sql): Promise<void> {
  return ensureTable(client);
}

export async function startWorkerBackground(existing?: postgres.Sql): Promise<void> {
  const sql = existing ?? getSql();
  await ensureTable(sql);
  void workerLoop(sql);
}

async function workerLoop(sql: postgres.Sql): Promise<void> {
  for (;;) {
    const job = await claimJob(sql, workerId);
    if (!job) {
      await sleep(1000);
      continue;
    }
    const handler = HANDLERS[job.kind];
    try {
      if (!handler) throw new Error(`no handler registered for job kind "${job.kind}"`);
      await handler(JSON.parse(job.payload) as Record<string, unknown>);
      await completeJob(sql, job.id);
    } catch (e) {
      console.error(`job ${job.id} (${job.kind}) failed: ${(e as Error).message}`);
      await failJob(sql, job.id, job.attempts, job.maxAttempts, (e as Error).message);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
