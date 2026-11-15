// Background worker: runs all idempotent jobs on an interval. Deploy ONE or more copies; the shared lock prevents duplicate work.
//   npm run worker                      (uses MONGODB_URI, JOB_INTERVAL_MINUTES=15 by default)
// Monitoring: a failing tick raises one deduplicated alert and a recovery notice follows the next good tick; the database is probed every tick;
// WORKER_HEARTBEAT_URL (optional, dead-man's-switch) is pinged after each successful tick so a worker that silently stops is noticed.
import mongoose from "mongoose";
import { alerts, ping } from "../src/lib/alerts";
import { reportDatabase } from "../src/lib/api-errors";
import { runAllJobs } from "../src/lib/jobs";
import { log, serializeError } from "../src/lib/log";
import { installProcessHandlers } from "../src/lib/process-monitor";

const minutes = Math.max(1, Number(process.env.JOB_INTERVAL_MINUTES || 15));
let stopping = false;
async function tick() {
  try {
    await Promise.race([mongoose.connection.db!.admin().ping(), new Promise((_, rej) => setTimeout(() => rej(new Error("database ping timed out")), 5000))]);
    reportDatabase(true);
    const r = await runAllJobs();
    log("info", "worker.tick", { skipped: "skipped" in r ? r.skipped : undefined });
    await alerts.resolve("worker.tick");
    await alerts.sweep();
    await ping(process.env.WORKER_HEARTBEAT_URL);
  } catch (error) {
    const e = serializeError(error);
    log("error", "worker.tick_failed", { error: e });
    reportDatabase(false, e.message);
    await alerts.raise("worker.tick", "Background worker tick failed", { message: e.message }, { severity: "critical" });
  }
}
async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  installProcessHandlers("worker");
  await mongoose.connect(process.env.MONGODB_URI);
  log("info", "worker.started", { intervalMinutes: minutes });
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  while (!stopping) { await tick(); for (let i = 0; i < minutes * 60 && !stopping; i++) await new Promise((r) => setTimeout(r, 1000)); }
  await mongoose.disconnect();
  log("info", "worker.stopped");
}
main().catch(async (e) => {
  log("error", "worker.fatal", { error: serializeError(e) });
  await alerts.raise("process.crash", "Background worker failed to start", { message: serializeError(e).message }, { severity: "critical" });
  process.exit(1);
});
