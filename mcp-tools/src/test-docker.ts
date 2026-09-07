import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./index.js";
import path from "node:path";

process.env.LUBUBBLE_WORKSPACE_ROOT = path.join(process.env.HOME ?? "", "lububble-projects");

async function main() {
  const server = createServer();
  const client = new Client({ name: "docker-test", version: "0.0.0" });
  const [c1, c2] = InMemoryTransport.createLinkedPair();
  await server.connect(c1);
  await client.connect(c2);

  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args as never });
    console.log(`--- ${name} ${res.isError ? "(ERROR)" : "(ok)"}`);
    for (const c of (res.content ?? []) as { text: string }[]) console.log(c.text.slice(0, 600));
  };

  const dir = "lububble-test";
  await call("compose_up", { project_dir: dir });
  await call("http_check", { url: "http://localhost:8081", expect_status: 200 });
  await call("compose_logs", { project_dir: dir });
  await call("compose_down", { project_dir: dir });
  console.log("docker test done");
}

main();
