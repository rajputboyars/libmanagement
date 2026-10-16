import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Library, User } from "@/lib/models";
import { AdmissionLead, BillingInvoice, BillingPayment, BillingWebhookEvent, Coupon, Organization, PlatformLead, PlatformSettings, Referral, SaaSAuditLog, SaaSPlan, SaaSSubscription, SubscriptionCredit, SupportTicket } from "@/lib/saas-models";
import { FEATURES } from "@/lib/saas";
import { accessForLibrary, audit, currentPlan, ensurePlans, getSettings, snapshotOf } from "@/lib/saas-server";
import { computeMetrics, computeProductMetrics } from "@/lib/saas-metrics";
import { reprocessEvent } from "@/lib/billing";
import { runAllJobs } from "@/lib/jobs";
import { notifyOrg } from "@/lib/saas-notify";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
type Lean = Record<string, unknown> & { _id: unknown };
const paged = (req: NextRequest) => Math.max(1, Number(req.nextUrl.searchParams.get("page") || 1));
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

async function admin() {
  const user = await currentUser();
  return user && user.role === "super-admin" ? user : null;
}

export async function GET(request: NextRequest) {
  const user = await admin();
  if (!user) return err("Platform administrator access required", 403);
  await ensurePlans();
  const p = request.nextUrl.searchParams;
  const view = p.get("view") || "overview";
  const page = paged(request);
  const skip = (page - 1) * 20;
  if (view === "overview") {
    const to = new Date(), from = new Date(to.getTime() - (Math.min(365, Math.max(7, Number(p.get("days") || 30)))) * 86400000);
    return NextResponse.json(await computeMetrics({ from, to, includeSandbox: p.get("sandbox") === "1" }));
  }
  if (view === "product") return NextResponse.json(await computeProductMetrics());
  if (view === "orgs") {
    const q = (p.get("q") || "").trim().slice(0, 60);
    const filter = q ? { name: new RegExp(escapeRegex(q), "i") } : {};
    const [orgs, total] = await Promise.all([Organization.find(filter).sort({ createdAt: -1 }).skip(skip).limit(20).lean<(Lean & { ownerId: unknown })[]>(), Organization.countDocuments(filter)]);
    const ids = orgs.map((o) => o._id);
    const [subs, owners, libs] = await Promise.all([SaaSSubscription.find({ organizationId: { $in: ids } }).lean<Lean[]>(), User.find({ _id: { $in: orgs.map((o) => o.ownerId) } }).select("name email").lean<Lean[]>(), Library.aggregate([{ $match: { organizationId: { $in: ids } } }, { $group: { _id: "$organizationId", branches: { $sum: 1 }, libs: { $push: "$_id" } } }])]);
    const studentCounts = await User.aggregate([{ $match: { role: "student", libraryId: { $in: libs.flatMap((l) => l.libs) } } }, { $group: { _id: "$libraryId", n: { $sum: 1 } } }]);
    const perLib = new Map(studentCounts.map((s) => [String(s._id), s.n as number]));
    return NextResponse.json({ total, page, items: orgs.map((o) => { const sub = subs.find((s) => String(s.organizationId) === String(o._id)); const l = libs.find((x) => String(x._id) === String(o._id)); return { ...o, owner: owners.find((u) => String(u._id) === String(o.ownerId)), subscription: sub ? { planKey: sub.planKey, status: sub.status, source: sub.source, mode: sub.mode, trialEnd: sub.trialEnd, currentPeriodEnd: sub.currentPeriodEnd, overrides: sub.overrides } : null, branches: l?.branches ?? 0, students: (l?.libs ?? []).reduce((s: number, id: unknown) => s + (perLib.get(String(id)) ?? 0), 0) }; }) });
  }
  if (view === "org") {
    const id = p.get("id") || "";
    if (!objectId.safeParse(id).success) return err("Organization not found", 404);
    const org = await Organization.findById(id).lean<Lean>();
    if (!org) return err("Organization not found", 404);
    const [sub, invoices, credits, audits, tickets, branches] = await Promise.all([SaaSSubscription.findOne({ organizationId: id }).lean(), BillingInvoice.find({ organizationId: id }).sort({ createdAt: -1 }).limit(20).lean(), SubscriptionCredit.find({ organizationId: id }).sort({ createdAt: -1 }).limit(20).lean(), SaaSAuditLog.find({ organizationId: id }).sort({ createdAt: -1 }).limit(30).lean(), SupportTicket.countDocuments({ organizationId: id, status: { $in: ["open", "pending"] } }), Library.find({ organizationId: id }).select("name branchName city").lean()]);
    return NextResponse.json({ org, subscription: sub, invoices, credits, audits, openTickets: tickets, branches });
  }
  if (view === "subscriptions") {
    const status = p.get("status");
    const filter = status ? { status } : {};
    const [items, total] = await Promise.all([SaaSSubscription.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(20).select("-history -planSnapshot.features").lean<Lean[]>(), SaaSSubscription.countDocuments(filter)]);
    const orgs = await Organization.find({ _id: { $in: items.map((i) => i.organizationId) } }).select("name isTest").lean<Lean[]>();
    return NextResponse.json({ total, page, items: items.map((i) => ({ ...i, org: orgs.find((o) => String(o._id) === String(i.organizationId)) })) });
  }
  if (view === "plans") return NextResponse.json({ plans: await SaaSPlan.find().sort({ key: 1, version: -1 }).lean(), features: FEATURES, settings: await getSettings() });
  if (view === "billing") {
    const status = p.get("status");
    const filter = status ? { status } : {};
    const [invoices, total, failed, events, eventsFailed] = await Promise.all([BillingInvoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(20).lean<Lean[]>(), BillingInvoice.countDocuments(filter), BillingPayment.find({ status: "failed" }).sort({ createdAt: -1 }).limit(20).lean<Lean[]>(), BillingWebhookEvent.find().sort({ createdAt: -1 }).limit(15).select("type status error attempts mode createdAt eventId").lean<Lean[]>(), BillingWebhookEvent.countDocuments({ status: "failed" })]);
    const orgs = await Organization.find({ _id: { $in: [...invoices, ...failed].map((i) => i.organizationId) } }).select("name").lean<Lean[]>();
    const name = (id: unknown) => (orgs.find((o) => String(o._id) === String(id)) as { name?: string } | undefined)?.name;
    return NextResponse.json({ total, page, invoices: invoices.map((i) => ({ ...i, orgName: name(i.organizationId) })), failedPayments: failed.map((f) => ({ ...f, orgName: name(f.organizationId) })), events, eventsFailed });
  }
  if (view === "growth") {
    const [coupons, referrals, leads, platformLeads] = await Promise.all([Coupon.find().sort({ createdAt: -1 }).limit(50).lean(), Referral.find().sort({ createdAt: -1 }).limit(30).lean<Lean[]>(), AdmissionLead.aggregate([{ $group: { _id: "$stage", n: { $sum: 1 } } }]), PlatformLead.find().sort({ createdAt: -1 }).limit(30).lean()]);
    const orgs = await Organization.find({ _id: { $in: referrals.flatMap((r) => [r.referrerOrgId, r.referredOrgId]) } }).select("name").lean<Lean[]>();
    return NextResponse.json({ coupons, referrals: referrals.map((r) => ({ ...r, referrerName: (orgs.find((o) => String(o._id) === String(r.referrerOrgId)) as { name?: string } | undefined)?.name, referredName: (orgs.find((o) => String(o._id) === String(r.referredOrgId)) as { name?: string } | undefined)?.name })), leadStages: Object.fromEntries(leads.map((l) => [l._id, l.n])), platformLeads });
  }
  if (view === "audit") {
    const [items, total] = await Promise.all([SaaSAuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(30).lean(), SaaSAuditLog.countDocuments()]);
    return NextResponse.json({ items, total, page });
  }
  return err("Unknown view", 404);
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await admin();
  if (!user) return err("Platform administrator access required", 403);
  if (limited(`saas-admin:${user._id}`, 60)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    const reason = z.string().trim().min(3, "A reason is required").max(300);
    const log = (organizationId: string | undefined, action: string, details?: unknown, targetId?: string) => audit({ organizationId, actorId: user._id, actorRole: "super-admin", action, targetType: "admin", targetId, details });
    let record: unknown = {};
    switch (body.action) {
      case "plan-save": {
        const v = z.object({ key: z.string().trim().toLowerCase().regex(/^[a-z][a-z0-9-]{1,29}$/), name: z.string().trim().min(2).max(40), description: z.string().trim().max(300).default(""), monthlyPaise: z.number().int().min(0).max(100000000), annualPaise: z.number().int().min(0).max(1000000000), trialDays: z.number().int().min(0).max(90).default(0), activeStudents: z.number().int().min(1).max(100000), branches: z.number().int().min(1).max(500), features: z.array(z.enum(Object.keys(FEATURES) as [string, ...string[]])).min(1), isPublic: z.boolean().default(true), providerPlanIds: z.object({ razorpay: z.object({ monthly: z.string().max(60).optional(), annual: z.string().max(60).optional() }).optional() }).default({}), sortOrder: z.number().int().min(0).max(100).default(0), reason }).parse(body.data);
        const latest = await SaaSPlan.findOne({ key: v.key }).sort({ version: -1 }).lean<{ version: number }>();
        const version = (latest?.version ?? 0) + 1;
        await SaaSPlan.updateMany({ key: v.key }, { current: false });
        // New version: existing subscribers keep the snapshot they bought; only new checkouts use the new terms.
        record = await SaaSPlan.create({ key: v.key, version, current: true, name: v.name, description: v.description, monthlyPaise: v.monthlyPaise, annualPaise: v.annualPaise, trialDays: v.trialDays, limits: { activeStudents: v.activeStudents, branches: v.branches }, features: v.features, isPublic: v.isPublic, providerPlanIds: v.providerPlanIds, sortOrder: v.sortOrder, createdBy: user._id });
        await log(undefined, "plan.save", { key: v.key, version, reason: v.reason }, v.key);
        break;
      }
      case "settings-save": {
        const v = z.object({ taxMode: z.enum(["none", "inclusive", "exclusive"]), taxRateBps: z.number().int().min(0).max(10000), gstin: z.string().trim().max(20).default(""), legalName: z.string().trim().max(120).default(""), graceDays: z.number().int().min(0).max(60), referralEnabled: z.boolean(), referralRewardPaise: z.number().int().min(0).max(10000000), referralMonthlyCap: z.number().int().min(0).max(1000), invoicePrefix: z.string().trim().min(1).max(8), reason }).parse(body.data);
        const { reason: why, ...fields } = v;
        record = await PlatformSettings.findOneAndUpdate({ key: "default" }, { $set: fields }, { upsert: true, new: true });
        await log(undefined, "settings.save", { ...fields, reason: why });
        break;
      }
      case "org-suspend":
      case "org-reinstate": {
        const v = z.object({ organizationId: objectId, reason }).parse(body.data);
        const suspend = body.action === "org-suspend";
        record = await Organization.findByIdAndUpdate(v.organizationId, { status: suspend ? "suspended" : "active", suspendedReason: suspend ? v.reason : "" }, { new: true });
        if (!record) throw new Error("Organization not found");
        await log(v.organizationId, suspend ? "org.suspend" : "org.reinstate", { reason: v.reason });
        await notifyOrg({ organizationId: v.organizationId, key: `status-org:${v.organizationId}:${suspend}:${Date.now()}`, kind: "account", title: suspend ? "Your account has been suspended" : "Your account has been reinstated", message: suspend ? `${v.reason}. Your data is kept and can be exported. Contact support.` : "Access is restored." });
        break;
      }
      case "org-test": {
        const v = z.object({ organizationId: objectId, isTest: z.boolean(), reason }).parse(body.data);
        record = await Organization.findByIdAndUpdate(v.organizationId, { isTest: v.isTest }, { new: true });
        await log(v.organizationId, "org.test-flag", { isTest: v.isTest, reason: v.reason });
        break;
      }
      case "trial-extend": {
        const v = z.object({ organizationId: objectId, days: z.number().int().min(1).max(90), reason }).parse(body.data);
        const sub = await SaaSSubscription.findOne({ organizationId: v.organizationId });
        if (!sub) throw new Error("Subscription not found");
        if (sub.source === "provider" && ["active", "past_due"].includes(sub.status)) throw new Error("This organization has a paid subscription");
        const pro = (await currentPlan(sub.planKey === "free" ? "pro" : sub.planKey))!;
        const base = sub.status === "trialing" && sub.trialEnd && sub.trialEnd > new Date() ? sub.trialEnd : new Date();
        if (sub.status !== "trialing") { sub.planKey = pro.key; sub.planVersion = pro.version; sub.planSnapshot = snapshotOf(pro); sub.trialStart = new Date(); }
        sub.status = "trialing"; sub.source = "trial"; sub.trialEnd = new Date(base.getTime() + v.days * 86400000);
        sub.history.push({ at: new Date(), status: "trialing", planKey: sub.planKey, reason: `Trial extended ${v.days}d: ${v.reason}`, by: user._id } as never);
        await sub.save(); record = sub;
        await log(v.organizationId, "subscription.trial-extend", { days: v.days, reason: v.reason });
        break;
      }
      case "grant-plan": {
        const v = z.object({ organizationId: objectId, planKey: z.string().min(2).max(30), until: z.iso.datetime(), reason }).parse(body.data);
        const plan = await currentPlan(v.planKey);
        const sub = await SaaSSubscription.findOne({ organizationId: v.organizationId });
        if (!plan || !sub) throw new Error("Plan or subscription not found");
        if (new Date(v.until) <= new Date()) throw new Error("Choose a future end date");
        if (sub.source === "provider" && ["active", "past_due"].includes(sub.status)) throw new Error("This organization has a paid subscription");
        sub.planKey = plan.key; sub.planVersion = plan.version; sub.planSnapshot = snapshotOf(plan); sub.status = "active"; sub.source = "admin"; sub.mode = "none"; sub.currentPeriodStart = new Date(); sub.currentPeriodEnd = new Date(v.until); sub.trialEnd = undefined;
        sub.history.push({ at: new Date(), status: "active", planKey: plan.key, reason: `Admin grant: ${v.reason}`, by: user._id } as never);
        await sub.save(); record = sub;
        await log(v.organizationId, "subscription.grant", { planKey: v.planKey, until: v.until, reason: v.reason });
        break;
      }
      case "sub-override": {
        const v = z.object({ organizationId: objectId, add: z.array(z.string()).default([]), remove: z.array(z.string()).default([]), activeStudents: z.number().int().min(1).max(100000).optional(), branches: z.number().int().min(1).max(500).optional(), expiresAt: z.iso.datetime().optional(), clear: z.boolean().default(false), reason }).parse(body.data);
        if ([...v.add, ...v.remove].some((f) => !(f in FEATURES))) throw new Error("Unknown feature");
        const sub = await SaaSSubscription.findOne({ organizationId: v.organizationId });
        if (!sub) throw new Error("Subscription not found");
        sub.overrides = v.clear ? undefined : { features: { add: v.add, remove: v.remove }, limits: { activeStudents: v.activeStudents, branches: v.branches }, expiresAt: v.expiresAt ? new Date(v.expiresAt) : undefined, reason: v.reason };
        sub.markModified("overrides"); await sub.save(); record = sub;
        await log(v.organizationId, v.clear ? "subscription.override-clear" : "subscription.override", { ...v });
        break;
      }
      case "credit-adjust": {
        const v = z.object({ organizationId: objectId, amountPaise: z.number().int().min(-10000000).max(10000000).refine((n) => n !== 0), reason }).parse(body.data);
        record = await SubscriptionCredit.create({ organizationId: v.organizationId, amountPaise: v.amountPaise, reason: "admin", key: `admin:${v.organizationId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, note: v.reason, createdBy: user._id });
        await log(v.organizationId, "credit.adjust", { amountPaise: v.amountPaise, reason: v.reason });
        break;
      }
      case "coupon-save": {
        const v = z.object({ id: objectId.optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,30}$/), name: z.string().trim().min(2).max(80), campaign: z.string().trim().max(60).default(""), type: z.enum(["percent", "fixed"]), value: z.number().int().min(1), maxRedemptions: z.number().int().min(1).max(100000), validFrom: z.iso.datetime().optional(), validTo: z.iso.datetime().optional(), plans: z.array(z.string()).default([]), active: z.boolean().default(true), providerOfferId: z.string().trim().max(60).default("") }).parse(body.data);
        if (v.type === "percent" && v.value > 100) throw new Error("Percent discounts cannot exceed 100");
        const { id, ...fields } = v;
        const doc = { ...fields, validFrom: v.validFrom ? new Date(v.validFrom) : undefined, validTo: v.validTo ? new Date(v.validTo) : undefined };
        record = id ? await Coupon.findByIdAndUpdate(id, doc, { new: true }) : await Coupon.create({ ...doc, createdBy: user._id });
        await log(undefined, "coupon.save", { code: v.code });
        break;
      }
      case "event-retry": {
        const v = z.object({ id: objectId }).parse(body.data);
        record = { outcome: await reprocessEvent(v.id) };
        await log(undefined, "billing.event-retry", undefined, v.id);
        break;
      }
      case "jobs-run": { record = await runAllJobs(new Date(), { force: true }); await log(undefined, "jobs.run", {}); break; }
      case "platform-lead-status": {
        const v = z.object({ id: objectId, status: z.enum(["new", "contacted", "scheduled", "closed"]) }).parse(body.data);
        record = await PlatformLead.findByIdAndUpdate(v.id, { status: v.status }, { new: true });
        break;
      }
      case "preview-entitlements": {
        const v = z.object({ organizationId: objectId }).parse(body.data);
        const lib = await Library.findOne({ organizationId: v.organizationId }).select("_id").lean<{ _id: unknown }>();
        record = lib ? (await accessForLibrary(lib._id as never))?.entitlements : null;
        break;
      }
      default: throw new Error("Unsupported action");
    }
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update", error instanceof z.ZodError ? 422 : 400);
  }
}

