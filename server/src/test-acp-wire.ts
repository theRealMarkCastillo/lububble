import { AcpProcess, type AcpSessionUpdate } from "./acp.js";

async function main() {
  const proc = new AcpProcess(
    { command: "hermes", args: ["acp", "--accept-hooks"], cwd: process.cwd() },
    (s) => {
      if (s.trim()) process.stderr.write(`[hermes] ${s}`);
    },
  );
  const init = (await proc.request("initialize", {
    protocolVersion: 1,
    clientCapabilities: {},
    clientInfo: { name: "lububble-smoke", version: "0.0.1" },
  }, 30_000)) as Record<string, unknown>;
  console.log("initialized:", init.agentInfo ?? "?", "proto", init.protocolVersion);

  const session = (await proc.request("session/new", { cwd: process.cwd(), mcpServers: [] })) as { sessionId: string };
  console.log("session:", session.sessionId);

  const chunks: string[] = [];
  proc.updates.on("update", (raw: unknown) => { if (process.env.DEBUG_UPDATES) console.log("UPDATE", JSON.stringify(raw).slice(0, 300));
    const u = raw as AcpSessionUpdate;
    if (u.method !== "session/update") return;
    const upd = (u.params as { update?: { sessionUpdate?: string; content?: unknown } }).update;
    if (upd?.sessionUpdate === "agent_message_chunk") {
      const c = upd.content;
      if (Array.isArray(c)) {
        for (const x of c as unknown as { text?: string }[]) {
          if (x.text) chunks.push(x.text);
        }
      } else if (c && typeof c === "object" && typeof (c as { text?: unknown }).text === "string") {
        chunks.push((c as { text: string }).text);
      }
    }
  });

  const result = (await proc.request("session/prompt", { sessionId: session.sessionId, prompt: [{ type: "text", text: "Reply with exactly the word: bubble" }] }, 240_000)) as { stopReason: string };
  console.log("stopReason:", result.stopReason);
  console.log("reply:", chunks.join("").trim());
  proc.kill();
  process.exit(0);
}

main();
