import { createApp } from "./index.js";

const PORT = Number(process.env.LUBUBBLE_PORT ?? 3001);
const HOST = process.env.LUBUBBLE_HOST ?? "127.0.0.1";
const app = createApp();
app.listen(PORT, HOST, () => {
  console.log(`lububble server listening on http://${HOST}:${PORT}`);
  if (HOST !== "127.0.0.1" && HOST !== "localhost") {
    console.error(
      "WARNING: non-loopback bind without an auth layer — restrict this VM to trusted networks (auth layer: SPEC-001 M4 candidate)",
    );
  }
});
