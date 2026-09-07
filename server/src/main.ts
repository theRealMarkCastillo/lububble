import { createApp } from "./index.js";

const PORT = Number(process.env.LUBUBBLE_PORT ?? 3001);
const app = createApp();
app.listen(PORT, "127.0.0.1", () => {
  console.log(`lububble server listening on http://127.0.0.1:${PORT} (config: ${process.env.LUBUBBLE_CONFIG_HINT ?? "$HOME/.lububble"})`);
});
