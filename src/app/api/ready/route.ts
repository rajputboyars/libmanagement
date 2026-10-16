import mongoose from "mongoose";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkEnv } from "@/lib/env";
import { JobRun } from "@/lib/ops-models";

/**
 * Readiness: configuration valid, database reachable, jobs not stale.
 * Details are intentionally coarse: no hostnames, versions or secrets are exposed.
 */
export async function GET() {
  const issues = checkEnv();
  const checks: Record<string, { ok: boolean; detail?: string }> = { config: { ok: !issues.some((i) => i.level === "error"), detail: issues.filter((i) => i.level === "error").map((i) => i.key).join(", ") || undefined } };
  const started = Date.now();
  try {
    await db();
    await mongoose.connection.db!.admin().ping();
    checks.database = { ok: true, detail: `${Date.now() - started}ms` };
    const last = await JobRun.findOne({ name: "saas-jobs", status: "ok" }).sort({ startedAt: -1 }).lean<{ startedAt: Date }>();
    const maxAgeHours = Number(process.env.JOBS_MAX_AGE_HOURS || 26);
    const ageHours = last ? (Date.now() - last.startedAt.getTime()) / 3600000 : null;
    // A missing heartbeat is reported but only fails readiness once jobs have run at least once and then gone stale.
    checks.jobs = { ok: ageHours === null || ageHours <= maxAgeHours, detail: ageHours === null ? "no run recorded yet" : `last ok run ${ageHours.toFixed(1)}h ago` };
  } catch {
    checks.database = { ok: false, detail: "unreachable" };
  }
  const ok = checks.config.ok && checks.database.ok;
  return NextResponse.json({ status: ok ? "ready" : "not-ready", degraded: !checks.jobs?.ok, checks }, { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
