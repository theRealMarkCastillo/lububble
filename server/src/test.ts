import { createApp } from "./index.js";
import { loadConfig } from "./config.js";

async function main() {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const j = async (r: Response) => {
    console.log(r.status, await r.text());
    return r;
  };

  await fetch(`${base}/api/health`);
  console.log("--- health ---");
  await (await fetch(`${base}/api/health`)).json().then((x) => console.log(x));

  console.log("--- create project invalid ---");
  await fetch(`${base}/api/projects`, { method: "POST", body: JSON.stringify({ name: "_bad name" }), headers: { "content-type": "application/json" } }).then(async (r) => console.log(r.status, await r.text()));

  console.log("--- create project ---");
  const created = await (
    await fetch(`${base}/api/projects`, { method: "POST", body: JSON.stringify({ name: "Demo App 01" }), headers: { "content-type": "application/json" } })
  ).json();
  console.log(created);

  console.log("--- list projects ---");
  await fetch(`${base}/api/projects`).then((r) => r.json()).then((x) => console.log(x));

  console.log("--- files ---");
  const files = await (await fetch(`${base}/api/projects/demo-app-01/files`)).json();
  console.log(files);

  console.log("--- read template file ---");
  console.log(await (await fetch(`${base}/api/projects/demo-app-01/file?path=app/page.tsx`)).text());

  console.log("--- write + read back ---");
  await fetch(`${base}/api/projects/demo-app-01/file?path=notes.md`, { method: "PUT", body: JSON.stringify({ content: "# notes\n" }), headers: { "content-type": "application/json" } });
  console.log(await (await fetch(`${base}/api/projects/demo-app-01/file?path=notes.md`)).text());

  console.log("--- escape attempt (should fail) ---");
  await fetch(`${base}/api/projects/demo-app-01/file?path=../../etc/hosts`, { method: "PUT", body: JSON.stringify({ content: "x" }), headers: { "content-type": "application/json" } }).then(async (r) => console.log(r.status, await r.text()));

  console.log("--- config ---");
  await fetch(`${base}/api/config`, { method: "PUT", body: JSON.stringify({ config: { providers: [{ id: "p1", name: "local", baseUrl: "http://localhost:8080/v1", model: "test-model", apiKey: "sk-test-1234567890" }], defaultProviderId: "p1" } }), headers: { "content-type": "application/json" } }).then((r) => r.json()).then((x) => console.log(x));
  console.log("config file:", JSON.parse(await (await import("fs/promises")).readFile((await import("./paths.js")).CONFIG_FILE, "utf8")));

  console.log("--- delete project ---");
  await fetch(`${base}/api/projects/demo-app-01`, { method: "DELETE" }).then(async (r) => console.log(r.status, await r.text()));
  await fetch(`${base}/api/projects`).then((r) => r.json()).then((x) => console.log(x));

  console.log("cfg loaded providers:", (await loadConfig()).providers.length);
  server.close();
  console.log("server test done");
}

main();
