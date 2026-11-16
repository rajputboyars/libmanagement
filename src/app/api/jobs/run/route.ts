import { NextRequest, NextResponse } from "next/server";
import { alerts, ping } from "@/lib/alerts";
import { cronAuthorized } from "@/lib/cron-auth";
import { executeCron } from "@/lib/cron";
import { db } from "@/lib/db";
import { runAllJobs } from "@/lib/jobs";
import { JobRun } from "@/lib/ops-models";

// Jobs can take a while on a big database. 300 s is the maximum Vercel allows on every plan (Fluid compute); confirm the current limit in the Vercel dashboard/docs.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

/**
 * Scheduler entry point. Vercel Cron calls GET with "Authorization: Bearer CRON_SECRET" (Hobby: once per day, any time within the scheduled hour);
 * other schedulers may POST with "x-cron-secret". The jobs are idempotent and a shared lock prevents overlapping runs, so a repeated or duplicate
 * invocation does no duplicate work. Heartbeat and alert behaviour: src/lib/cron.ts.
 */
async function run(request: NextRequest) {
  const { status, body } = await executeCron({
    authorized: cronAuthorized(request.headers),
    connect: () => db(),
    run: () => runAllJobs(),
    ping: (url) => ping(url),
    alerts,
    previousRunFailed: async () => (await JobRun.findOne({ name: "cron" }).sort({ startedAt: -1 }).select("status").lean<{ status?: string }>())?.status === "failed",
    recordRun: async (state, detail) => { await JobRun.create({ name: "cron", status: state, startedAt: new Date(), durationMs: 0, ...(detail ? { error: detail.slice(0, 300) } : {}) }); },
    env: process.env,
  });
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
export const GET = run;
export const POST = run;
