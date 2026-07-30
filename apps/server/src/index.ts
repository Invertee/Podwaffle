import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { log } from "./logging.js";

const config = await loadConfig();
const runtime = await createRuntime(config);

runtime.server.listen(config.port, "0.0.0.0", () => {
  log("info", "server.ready", {
    port: config.port,
    version: process.env.PODWAFFLE_VERSION ?? "0.1.0",
    schemaVersion: runtime.database.schemaVersion,
  });
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "server.shutdown", { signal });
  await runtime.close();
  process.exitCode = 0;
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
