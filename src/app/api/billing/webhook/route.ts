import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ingestWebhook } from "@/lib/billing";

// Raw body is required for signature verification: never parse before verifying.
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 512 * 1024) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  await db();
  const result = await ingestWebhook(raw, request.headers.get("x-razorpay-signature"), request.headers.get("x-razorpay-event-id"));
  return NextResponse.json("error" in result ? { error: result.error } : { ok: true, duplicate: "duplicate" in result ? result.duplicate : false }, { status: result.status });
}
