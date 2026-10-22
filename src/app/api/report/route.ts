import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { ReportShare } from "@/lib/models";
import { buildWeeklyReport, shareWeeklyReport } from "@/lib/weekly-report";

const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

/** GET ?token=… is public (the shared snapshot only); without a token it is the signed-in student's live report. */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (token !== null) {
    if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return err("This report link is not valid", 404);
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
    if (limited(`report-view:${ip}`, 60)) return err("Please slow down", 429);
    const share = await ReportShare.findOne({ token, expiresAt: { $gt: new Date() } }).select("report expiresAt").lean<{ report: unknown; expiresAt: Date }>();
    if (!share) return err("This report link has expired or does not exist", 404);
    return NextResponse.json({ report: share.report, expiresAt: share.expiresAt }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  }
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("Weekly reports are for students", 403);
  return NextResponse.json({ report: await buildWeeklyReport(user._id) });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("Weekly reports are for students", 403);
  if (limited(`report-share:${user._id}`, 10)) return err("Please slow down", 429);
  try {
    const body = await request.json();
    const action = z.enum(["share", "revoke"]).parse(body.action);
    if (action === "revoke") {
      await ReportShare.deleteMany({ userId: user._id });
      return NextResponse.json({ ok: true });
    }
    const { token } = await shareWeeklyReport(user._id);
    return NextResponse.json({ token, path: `/r/${token}` });
  } catch (e) {
    return err(e instanceof Error ? e.message : "Could not create the link");
  }
}
