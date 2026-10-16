import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { limited, validOrigin } from "@/lib/auth";
import { db } from "@/lib/db";
import { Library } from "@/lib/models";
import { AdmissionLead, PlatformLead } from "@/lib/saas-models";
import { leadKey } from "@/lib/saas";
import { accessForLibrary } from "@/lib/saas-server";
import { notifyOrg } from "@/lib/saas-notify";

const ok = () => NextResponse.json({ ok: true, message: "Thank you. The team will get back to you." });
const fail = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const text = (max: number) => z.string().trim().max(max).default("");

/** Public, unauthenticated enquiry forms: library admission enquiries and StudyQuest demo bookings. */
export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return fail("Invalid origin", 403);
  const ip = (request.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
  if (limited(`lead:${ip}`, 5)) return fail("Too many requests. Please try again in a minute.", 429);
  try {
    await db();
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.website === "string" && body.website) return ok(); // honeypot: bots fill hidden fields
    if (body.kind === "demo") {
      const v = z.object({ name: z.string().trim().min(2).max(80), email: z.email(), phone: text(20), libraryName: text(100), message: text(500), consentContact: z.literal(true, { error: "Please agree to be contacted" }) }).parse(body);
      if (await PlatformLead.exists({ email: v.email.toLowerCase(), createdAt: { $gt: new Date(Date.now() - 86400000) } })) return ok();
      await PlatformLead.create(v);
      return ok();
    }
    const v = z.object({ library: z.string().trim().toLowerCase().min(3).max(60), name: z.string().trim().min(2).max(80), phone: text(20), email: z.union([z.literal(""), z.email()]).default(""), message: text(500), source: z.enum(["website", "social", "campaign", "referral"]).default("website"), campaign: text(60), consentContact: z.boolean().default(false) }).parse(body);
    const library = await Library.findOne({ publicSlug: v.library, listingVisible: true }).select("_id organizationId").lean<{ _id: unknown; organizationId?: unknown }>();
    if (!library) return fail("This library is not accepting online enquiries", 404);
    const access = await accessForLibrary(library._id as never);
    if (!access || access.org.status === "suspended" || !access.entitlements.features.includes("crm")) return fail("This library is not accepting online enquiries", 404);
    const key = leadKey(v.phone, v.email);
    if (!key) return fail("Enter a phone number (10 digits) or an email");
    const today = new Date(Date.now() - 86400000);
    if ((await AdmissionLead.countDocuments({ libraryId: library._id, createdAt: { $gt: today } })) >= 100) return fail("This library has reached its daily enquiry limit. Please try tomorrow.", 429);
    const existing = await AdmissionLead.findOne({ libraryId: library._id, dedupeKey: key });
    if (existing) {
      existing.enquiryCount += 1; existing.history.push({ at: new Date(), stage: existing.stage, note: "Repeat enquiry" } as never);
      if (v.consentContact && !existing.consentContact) { existing.consentContact = true; existing.consentAt = new Date(); }
      await existing.save();
      return ok(); // same response whether new or duplicate: no information leak
    }
    const lead = await AdmissionLead.create({ libraryId: library._id, organizationId: library.organizationId, name: v.name, phone: v.phone, email: v.email, message: v.message, source: v.source, campaign: v.campaign, consentContact: v.consentContact, consentAt: v.consentContact ? new Date() : undefined, dedupeKey: key, history: [{ at: new Date(), stage: "new", note: "Online enquiry" }] });
    await notifyOrg({ organizationId: access.org._id, key: `lead:${lead._id}`, kind: "lead", title: "New admission enquiry", message: `${v.name} enquired about your library.` }).catch(() => null);
    return ok();
  } catch (error) {
    return fail(error instanceof z.ZodError ? error.issues[0]?.message || "Check the form" : "Unable to send. Please try again.", error instanceof z.ZodError ? 422 : 400);
  }
}
