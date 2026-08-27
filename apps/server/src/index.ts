import { loadConfig } from "./config.js";
import { createRuntime } from "./runtime.js";
import { configureLogging, log } from "./logging.js";

const config = await loadConfig();
configureLogging(config.log_level);
const runtime = await createRuntime(config);

runtime.server.listen(config.port, "0.0.0.0", () => {
  log("info", "server.ready", {
    message: `Podwaffle is ready on port ${config.port}`,
    port: config.port,
    version: process.env.PODWAFFLE_VERSION ?? "0.1.0",
    schemaVersion: runtime.database.schemaVersion,
  });
  runtime.operationalStatus.report(true);
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "server.shutdown", {
    message: `Podwaffle is shutting down (${signal})`,
  });
  await runtime.close();
  process.exitCode = 0;
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
