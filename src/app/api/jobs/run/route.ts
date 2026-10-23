import { NextRequest, NextResponse } from "next/server";
import { cronAuthorized } from "@/lib/cron-auth";
import { db } from "@/lib/db";
import { runAllJobs } from "@/lib/jobs";

// Jobs can take a while on a big database.
export const maxDuration = 300;

/** Scheduler entry point. Vercel Cron calls GET with "Authorization: Bearer CRON_SECRET"; other schedulers may POST with "x-cron-secret". */
async function run(request: NextRequest) {
  if (!cronAuthorized(request.headers)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db();
  return NextResponse.json({ ok: true, result: await runAllJobs() });
}
export const GET = run;
export const POST = run;
