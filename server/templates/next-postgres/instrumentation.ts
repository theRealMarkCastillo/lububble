export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (bootstrapped) return;
  bootstrapped = true;
  const { getSql } = await import("./db/jobs");
  const { ensureJobsTable, startWorkerBackground } = await import("./db/worker");
  const sql = getSql();
  await ensureJobsTable(sql);
  void startWorkerBackground(sql);
}

let bootstrapped = false;
