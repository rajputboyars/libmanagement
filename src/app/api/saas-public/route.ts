import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { FEATURES } from "@/lib/saas";
import { SaaSPlan } from "@/lib/saas-models";
import { ensurePlans, getSettings } from "@/lib/saas-server";

/** Public pricing, read from the database. Provider plan ids and internals are never exposed. */
export async function GET() {
  await db();
  await ensurePlans();
  const [plans, settings] = await Promise.all([SaaSPlan.find({ current: true, isPublic: true }).sort({ sortOrder: 1 }).select("key name description monthlyPaise annualPaise trialDays limits features").lean(), getSettings()]);
  return NextResponse.json({ plans, features: FEATURES, tax: { mode: settings.taxMode, rateBps: settings.taxRateBps }, currency: "INR" }, { headers: { "Cache-Control": "public, max-age=60" } });
}
