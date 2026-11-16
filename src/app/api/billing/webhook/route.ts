import { NextRequest, NextResponse } from "next/server";
import { reportUnexpected } from "@/lib/api-errors";
import { db } from "@/lib/db";
import { ingestWebhook } from "@/lib/billing";

const headers = { "Cache-Control": "no-store" };

/**
 * Payment-gateway webhook. The signature is verified over the RAW body before anything is parsed or stored; the browser never reaches this
 * route with a "payment succeeded" claim that counts: only signed gateway events change invoices, payments or subscriptions.
 * Status contract for the gateway: 200 = handled or deliberately ignored/rejected (no retry), 400 = bad signature/malformed, 5xx = retry later.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (raw.length > 512 * 1024) return NextResponse.json({ error: "Payload too large" }, { status: 413, headers });
  try {
    await db();
  } catch (error) {
    reportUnexpected(error, "/api/billing/webhook");
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503, headers });
  }
  try {
    const result = await ingestWebhook(raw, request.headers.get("x-razorpay-signature"), request.headers.get("x-razorpay-event-id"));
    return NextResponse.json("error" in result ? { error: result.error } : { ok: true, duplicate: "duplicate" in result ? result.duplicate : false, ...("outcome" in result && result.outcome === "rejected" ? { rejected: true } : {}) }, { status: result.status, headers });
  } catch (error) {
    reportUnexpected(error, "/api/billing/webhook");
    return NextResponse.json({ error: "Processing failed; the provider should retry" }, { status: 500, headers });
  }
}
