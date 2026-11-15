import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { alerts } from "@/lib/alerts";
import { reportDatabase } from "@/lib/api-errors";
import { db } from "@/lib/db";
import { checkEnv } from "@/lib/env";
import { JobRun } from "@/lib/ops-models";

export const dynamic = "force-dynamic";
const PROBE_TIMEOUT_MS = Number(process.env.READY_DB_TIMEOUT_MS || 3000);
const timeout = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS).unref?.())]);

/**
 * Readiness: configuration valid, database reachable (bounded wait), jobs not stale.
 * The body is deliberately coarse: no hostnames, versions, error text, counts or any tenant/business data. Use /api/health for liveness.
 * 200 = ready, 503 = not ready. `degraded: true` (still 200) means something non-essential, such as the job heartbeat, needs attention.
 */
export async function GET() {
  const issues = checkEnv();
  const checks: Record<string, { ok: boolean; detail?: string }> = { config: { ok: !issues.some((i) => i.level === "error"), detail: issues.some((i) => i.level === "error") ? `${issues.filter((i) => i.level === "error").length} configuration error(s); see server logs (config.issue)` : undefined } };
  const started = Date.now();
  try {
    await timeout((async () => { await db(); await mongoose.connection.db!.admin().ping(); })());
    checks.database = { ok: true, detail: `${Date.now() - started}ms` };
    reportDatabase(true);
    try {
      const last = await timeout(JobRun.findOne({ name: "saas-jobs", status: "ok" }).sort({ startedAt: -1 }).lean<{ startedAt: Date }>().exec());
      const maxAgeHours = Number(process.env.JOBS_MAX_AGE_HOURS || 26);
      const ageHours = last ? (Date.now() - last.startedAt.getTime()) / 3600000 : null;
      // A missing heartbeat is reported but only degrades readiness once jobs have run at least once and then gone stale.
      checks.jobs = { ok: ageHours === null || ageHours <= maxAgeHours, detail: ageHours === null ? "no run recorded yet" : `last ok run ${ageHours.toFixed(1)}h ago` };
    } catch {
      checks.jobs = { ok: false, detail: "unknown" };
    }
  } catch {
    checks.database = { ok: false, detail: "unreachable" };
    reportDatabase(false, "readiness probe failed");
  }
  void alerts.sweep().catch(() => undefined);
  const ok = checks.config.ok && checks.database.ok;
  return NextResponse.json({ status: ok ? "ready" : "not-ready", degraded: !!checks.jobs && !checks.jobs.ok, alerting: process.env.ALERT_WEBHOOK_URL ? "configured" : "not-configured", checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
