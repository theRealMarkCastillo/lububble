import { createApp } from "./index.js";

async function main() {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const created = await (
    await fetch(`${base}/api/projects`, { method: "POST", body: JSON.stringify({ name: "acp-demo" }), headers: { "content-type": "application/json" } })
  ).json();
  console.log("created:", JSON.stringify(created));

  const prompt = [
    "You are building inside a Lububble-managed project. Directory contains a Next.js app template.",
    "Tasks, in order:",
    "1. Edit app/page.tsx so the h1 reads exactly: ACP Loop Works",
    `2. Run compose_up on the project_dir "." (docker-compose.yml is in this directory; .env has APP_PORT=${created.ports?.dev ?? ""}).`,
    `3. Run http_check on http://localhost:${created.ports?.dev ?? ""} expecting status 200.`,
    "Finish only after the HTTP check passes (status=200).",
  ].join(" ");

  console.log("prompting agent (this can take minutes for the docker build)...");
  const started = Date.now();
  const res = await fetch(`${base}/api/projects/acp-demo/prompt`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  const body = await res.json();
  console.log(`status: ${res.status} in ${Math.round((Date.now() - started) / 1000)}s`);
  console.log(JSON.stringify(body, null, 2));

  const page = await (await fetch(`${base}/api/projects/acp-demo/file?path=app/page.tsx`)).text();
  console.log("h1 check:", page.includes("ACP Loop Works") ? "PASS" : "FAIL");
  server.close();
  process.exit(0);
}

main();
