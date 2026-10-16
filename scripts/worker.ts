// Background worker: runs all idempotent jobs on an interval. Deploy ONE or more copies; the shared lock prevents duplicate work.
//   npm run worker                      (uses MONGODB_URI, JOB_INTERVAL_MINUTES=15 by default)
import mongoose from "mongoose";
import { runAllJobs } from "../src/lib/jobs";
import { alert, log } from "../src/lib/log";

const minutes = Math.max(1, Number(process.env.JOB_INTERVAL_MINUTES || 15));
let stopping = false;
async function tick() {
  try { const r = await runAllJobs(); log("info", "worker.tick", { skipped: "skipped" in r ? r.skipped : undefined }); }
  catch (error) { log("error", "worker.tick_failed", { message: error instanceof Error ? error.message : "error" }); await alert("worker.tick_failed", { message: error instanceof Error ? error.message : "error" }); }
}
async function main() {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is required");
  await mongoose.connect(process.env.MONGODB_URI);
  log("info", "worker.started", { intervalMinutes: minutes });
  const stop = () => { stopping = true; };
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
  while (!stopping) { await tick(); for (let i = 0; i < minutes * 60 && !stopping; i++) await new Promise((r) => setTimeout(r, 1000)); }
  await mongoose.disconnect();
  log("info", "worker.stopped");
}
main().catch((e) => { console.error(e); process.exit(1); });
