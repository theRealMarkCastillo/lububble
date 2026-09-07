import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./index.js";
import { promises as fs } from "node:fs";
import path from "node:path";

process.env.LUBUBBLE_WORKSPACE_ROOT = "";
const root = path.join(process.env.HOME ?? "", "lububble-projects", "_test");
process.env.LUBUBBLE_WORKSPACE_ROOT = path.dirname(root);

async function main() {
  const server = createServer();
  const client = new Client({ name: "test", version: "0.0.0" });
  const [c1, c2] = InMemoryTransport.createLinkedPair();
  await server.connect(c1);
  await client.connect(c2);

  const call = async (name: string, args: unknown) => {
    const res = await client.callTool({ name, arguments: args as never });
    console.log(`--- ${name} ---`);
    for (const c of (res.content ?? []) as { text: string }[]) console.log(res.isError ? "[ERR] " : "", c.text);
  };

  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, "hello.txt"), "hi", "utf8");

  await call("list_files", { path: path.basename(root) });
  await call("read_file", { path: `${path.basename(root)}/hello.txt` });
  await call("write_file", { path: `${path.basename(root)}/sub/tmp.txt`, content: "abcdefgh01:23:45" });
  await call("list_files", { path: "." });
  await call("http_check", { url: "http://localhost:9", expect_status: 418 });

  console.log("sandbox weld test done");
}

main();
