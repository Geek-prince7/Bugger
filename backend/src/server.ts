import { config } from "./config.js";
import { poolFor } from "./db.js";
import { app } from "./app.js";
const settings = config(),
  pool = poolFor(settings.DATABASE_URL),
  server = await app(settings, pool);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await server.close();
  await pool.end();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
await server.listen({ host: settings.HOST, port: settings.PORT });
