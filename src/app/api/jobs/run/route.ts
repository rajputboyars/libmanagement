import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { runAllJobs } from "@/lib/jobs";

/** Scheduler entry point (cron, GitHub Actions, etc.). Requires CRON_SECRET; admins can also run jobs from the panel. */
export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(secret ?? ""), b = Buffer.from(given);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db();
  return NextResponse.json({ ok: true, result: await runAllJobs() });
}
