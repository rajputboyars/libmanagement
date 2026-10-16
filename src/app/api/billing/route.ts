import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { BillingCheckout, BillingInvoice, BillingPayment, Coupon, CouponRedemption, Organization, Referral, SaaSPlan, SaaSSubscription, SubscriptionCredit } from "@/lib/saas-models";
import { computeInvoice, couponDiscount, couponUsable } from "@/lib/saas";
import { PlanError, accessForLibrary, activeStudentCount, audit, currentPlan, ensurePlans, getSettings, snapshotOf, verifyOrgOwner } from "@/lib/saas-server";
import { creditBalance } from "@/lib/referrals";
import { getProvider, providerConfig, ingestSandbox, sandboxEvent } from "@/lib/billing";
import { Library } from "@/lib/models";

const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
const interval = z.enum(["monthly", "annual"]);
type Lean = Record<string, unknown> & { _id: unknown };
const price = (plan: { monthlyPaise: number; annualPaise: number }, i: "monthly" | "annual") => (i === "annual" ? plan.annualPaise : plan.monthlyPaise);

async function authed() {
  const user = await currentUser();
  if (!user) return { error: err("Sign in required", 401) };
  if (!["owner", "staff"].includes(user.role) || !user.libraryId) return { error: err("Library team access required", 403) };
  return { user };
}

export async function GET(request: NextRequest) {
  const a = await authed();
  if ("error" in a) return a.error;
  const { user } = a;
  await ensurePlans();
  const access = await accessForLibrary(user.libraryId!);
  if (!access) return err("Organization not found", 404);
  const orgId = access.org._id;
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const cfg = providerConfig();
  const [plans, invoices, invoiceTotal, credits, balance, org, referrals, branches, students, used] = await Promise.all([
    SaaSPlan.find({ current: true, isPublic: true }).sort({ sortOrder: 1 }).select("-providerPlanIds").lean<Lean[]>(),
    BillingInvoice.find({ organizationId: orgId }).sort({ createdAt: -1 }).skip((page - 1) * 10).limit(10).lean<Lean[]>(),
    BillingInvoice.countDocuments({ organizationId: orgId }),
    SubscriptionCredit.find({ organizationId: orgId }).sort({ createdAt: -1 }).limit(20).lean<Lean[]>(),
    creditBalance(orgId),
    Organization.findById(orgId).select("referralCode").lean<{ referralCode?: string }>(),
    Referral.find({ referrerOrgId: orgId }).sort({ createdAt: -1 }).limit(20).select("status createdAt rejectReason").lean<Lean[]>(),
    Library.countDocuments({ organizationId: orgId }),
    activeStudentCount(orgId),
    BillingPayment.find({ organizationId: orgId, status: "failed" }).sort({ createdAt: -1 }).limit(1).lean<Lean[]>(),
  ]);
  const sub = access.sub as (Lean & { status: string }) | null;
  return NextResponse.json({
    provider: { name: cfg.provider, mode: cfg.mode, configured: cfg.configured, sandbox: cfg.mode === "sandbox", usable: cfg.usable },
    subscription: sub ? { status: sub.status, planKey: sub.planKey, planSnapshot: sub.planSnapshot, interval: sub.interval, trialEnd: sub.trialEnd, currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: sub.cancelAtPeriodEnd, source: sub.source, mode: sub.mode, couponCode: sub.couponCode } : null,
    entitlements: access.entitlements, usage: { activeStudents: students, branches }, plans, invoices, invoiceTotal, page, credits: { balancePaise: balance, ledger: credits },
    referral: { code: org?.referralCode, items: referrals, rewardPaise: access.settings.referralRewardPaise, enabled: access.settings.referralEnabled }, tax: { mode: access.settings.taxMode, rateBps: access.settings.taxRateBps },
    failedPayment: used[0] ?? null, role: user.role,
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const a = await authed();
  if ("error" in a) return a.error;
  const { user } = a;
  if (limited(`billing:${user._id}`, 20)) return err("Please slow down", 429);
  try {
    const orgId = await verifyOrgOwner(user);
    const access = await accessForLibrary(user.libraryId!);
    if (!access) throw new Error("Organization not found");
    if (access.org.status === "suspended") throw new PlanError("This account is suspended. Contact support.", "suspended");
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    const sub = await SaaSSubscription.findOne({ organizationId: orgId });
    if (!sub) throw new Error("Subscription not found");

    if (body.action === "coupon-check" || body.action === "checkout") {
      const v = z.object({ planKey: z.string().min(2).max(30), interval, couponCode: z.string().trim().max(30).optional() }).parse(body.data);
      const plan = await SaaSPlan.findOne({ key: v.planKey, current: true, isPublic: true }).lean<Lean & { key: string; version: number; monthlyPaise: number; annualPaise: number; providerPlanIds: Record<string, Record<string, string>> }>();
      if (!plan) throw new Error("Plan not found");
      const list = price(plan, v.interval);
      if (list <= 0) throw new Error("Choose the Free plan from the plan list instead");
      let discount = 0, coupon: Lean & { code: string; providerOfferId?: string } | null = null;
      if (v.couponCode) {
        coupon = await Coupon.findOne({ code: v.couponCode.toUpperCase() }).lean<Lean & { code: string; providerOfferId?: string; type: "percent" | "fixed"; value: number; active: boolean; maxRedemptions: number; redemptions: number; plans?: string[] }>();
        if (!coupon) throw new Error("That code is not valid");
        const c = coupon as unknown as Parameters<typeof couponUsable>[0] & { type: "percent" | "fixed"; value: number };
        const problem = couponUsable(c, v.planKey, new Date());
        if (problem) throw new Error(problem);
        if (await CouponRedemption.exists({ couponId: coupon._id, organizationId: orgId })) throw new Error("Your organization has already used this code");
        discount = couponDiscount(c, list);
      }
      const cfg = providerConfig();
      if (body.action === "coupon-check") return NextResponse.json({ ok: true, listPaise: list, discountPaise: discount, payablePaise: list - discount, ...(coupon && cfg.provider === "razorpay" && !coupon.providerOfferId ? { warning: "This code cannot be applied to live gateway billing yet." } : {}) });
      if (coupon && cfg.provider === "razorpay" && !coupon.providerOfferId) throw new Error("This code cannot be applied to live billing yet. Contact support.");
      const provider = getProvider();
      const checkoutId = new mongoose.Types.ObjectId();
      const created = await provider.createSubscription({ checkoutId: String(checkoutId), organizationId: String(orgId), planKey: v.planKey, interval: v.interval, providerPlanId: plan.providerPlanIds?.[cfg.provider]?.[v.interval], offerId: coupon?.providerOfferId || undefined });
      const checkout = await BillingCheckout.create({ _id: checkoutId, organizationId: orgId, planKey: plan.key, planVersion: plan.version, interval: v.interval, provider: cfg.provider, mode: cfg.mode, providerSubscriptionId: created.providerSubscriptionId, checkoutUrl: created.checkoutUrl, couponCode: coupon?.code, createdBy: user._id });
      await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "billing.checkout", targetType: "checkout", targetId: String(checkout._id), details: { planKey: v.planKey, interval: v.interval, mode: cfg.mode } });
      return NextResponse.json({ ok: true, checkoutUrl: created.checkoutUrl, sandbox: cfg.provider === "sandbox", notice: cfg.provider === "sandbox" ? "Sandbox billing: no real payment will be taken." : undefined });
    }

    if (body.action === "cancel") {
      if (sub.source !== "provider" || !sub.providerSubscriptionId || sub.status === "canceled") throw new Error("There is no paid subscription to cancel");
      await getProvider().cancelSubscription(sub.providerSubscriptionId, true);
      // Final state arrives from the verified webhook; until then only the intent is recorded.
      const fresh = await SaaSSubscription.findOne({ organizationId: orgId });
      if (fresh && fresh.status !== "canceled") { fresh.cancelAtPeriodEnd = true; await fresh.save(); }
      await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "billing.cancel", targetType: "subscription", targetId: String(sub._id) });
      return NextResponse.json({ ok: true, notice: "Cancellation requested. Access continues until the end of the paid period." });
    }

    if (body.action === "switch-free") {
      if (sub.source === "provider" && sub.status !== "canceled" && sub.status !== "expired") throw new Error("Cancel your paid subscription first; you keep access until the period ends");
      const free = (await currentPlan("free"))!;
      sub.planKey = free.key; sub.planVersion = free.version; sub.planSnapshot = snapshotOf(free); sub.status = "active"; sub.source = "free"; sub.mode = "none";
      sub.trialEnd = undefined; sub.currentPeriodStart = new Date(); sub.currentPeriodEnd = undefined; sub.providerSubscriptionId = undefined; sub.cancelAtPeriodEnd = false;
      sub.history.push({ at: new Date(), status: "active", planKey: "free", reason: "Switched to Free", by: user._id } as never);
      await sub.save();
      await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "billing.switch-free" });
      return NextResponse.json({ ok: true });
    }

    if (body.action === "credit-prepay") {
      const v = z.object({ planKey: z.string().min(2).max(30), months: z.number().int().min(1).max(12) }).parse(body.data);
      if (sub.source === "provider" && ["active", "past_due"].includes(sub.status)) throw new Error("Credits can prepay a plan only when no gateway subscription is running");
      const plan = await SaaSPlan.findOne({ key: v.planKey, current: true, isPublic: true }).lean<Lean & { key: string; version: number; name: string; monthlyPaise: number; annualPaise: number; limits: { activeStudents: number; branches: number }; features: string[] }>();
      if (!plan || plan.monthlyPaise <= 0) throw new Error("Choose a paid plan");
      const cost = plan.monthlyPaise * v.months;
      const settings = await getSettings();
      const session = await mongoose.startSession();
      let invoiceNumber = "";
      try {
        await session.withTransaction(async () => {
          if ((await creditBalance(orgId)) < cost) throw new Error("Not enough subscription credit");
          const key = `prepay:${orgId}:${new mongoose.Types.ObjectId()}`;
          await SubscriptionCredit.create([{ organizationId: orgId, amountPaise: -cost, reason: "prepay", key, note: `${plan.name} × ${v.months} month(s)`, createdBy: user._id }], { session });
          const now = new Date();
          const start = sub.source === "credit" && sub.currentPeriodEnd && sub.currentPeriodEnd > now && sub.planKey === plan.key ? sub.currentPeriodEnd : now;
          const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + v.months);
          const seq = await mongoose.model("PlatformSettings").findOneAndUpdate({ key: "default" }, { $inc: { invoiceSeq: 1 } }, { new: true, session, upsert: true }).lean<{ invoiceSeq: number }>();
          invoiceNumber = `${settings.invoicePrefix}-${now.getUTCFullYear()}-${String(seq!.invoiceSeq).padStart(6, "0")}`;
          const calc = computeInvoice({ subtotalPaise: cost, tax: { mode: "none", rateBps: 0 } });
          await BillingInvoice.create([{ organizationId: orgId, subscriptionId: sub._id, number: invoiceNumber, mode: "credit", planKey: plan.key, periodStart: start, periodEnd: end, lineItems: [{ description: `${plan.name} plan prepaid with credit (${v.months} mo)`, amountPaise: cost }], ...calc, amountPaidPaise: cost, status: "paid", paidAt: now }], { session });
          sub.planKey = plan.key; sub.planVersion = plan.version; sub.planSnapshot = snapshotOf(plan); sub.interval = "monthly"; sub.status = "active"; sub.source = "credit"; sub.mode = "none";
          sub.currentPeriodStart = start; sub.currentPeriodEnd = end; sub.trialEnd = undefined; sub.providerSubscriptionId = undefined; sub.pastDueSince = undefined;
          sub.history.push({ at: now, status: "active", planKey: plan.key, reason: "Prepaid with credit", by: user._id } as never);
          await sub.save({ session });
        });
      } finally { await session.endSession(); }
      await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "billing.credit-prepay", details: { planKey: v.planKey, months: v.months, invoice: invoiceNumber } });
      return NextResponse.json({ ok: true, invoice: invoiceNumber });
    }
    throw new Error("Unsupported action");
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, error.code === "forbidden" ? 403 : 402, error.code);
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update billing", error instanceof z.ZodError ? 422 : 400);
  }
}

/** Sandbox-only: completes or fails a checkout by sending signed, Razorpay-shaped events through the real webhook path. */
export async function PUT(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const a = await authed();
  if ("error" in a) return a.error;
  const { user } = a;
  try {
    const cfg = providerConfig();
    if (cfg.provider !== "sandbox" || !cfg.usable) return err("Sandbox billing is not enabled", 403);
    const orgId = await verifyOrgOwner(user);
    const v = z.object({ checkoutId: z.string().regex(/^[a-f\d]{24}$/i), outcome: z.enum(["success", "failure"]) }).parse(await request.json());
    const checkout = await BillingCheckout.findOne({ _id: v.checkoutId, organizationId: orgId });
    if (!checkout || checkout.provider !== "sandbox") throw new Error("Checkout not found");
    if (checkout.status === "completed") throw new Error("This checkout is already completed");
    const plan = await SaaSPlan.findOne({ key: checkout.planKey, version: checkout.planVersion }).lean<Lean & { monthlyPaise: number; annualPaise: number }>();
    let amount = plan ? price(plan, checkout.interval) : 0;
    if (checkout.couponCode) { const c = await Coupon.findOne({ code: checkout.couponCode }).lean<{ type: "percent" | "fixed"; value: number }>(); if (c) amount -= couponDiscount(c, amount); }
    const pid = `sandbox_pay_${new mongoose.Types.ObjectId()}`;
    const days = checkout.interval === "annual" ? 365 : 30;
    if (v.outcome === "success") {
      await ingestSandbox(sandboxEvent("subscription.activated", { subscriptionId: checkout.providerSubscriptionId, periodDays: days }));
      await ingestSandbox(sandboxEvent("subscription.charged", { subscriptionId: checkout.providerSubscriptionId, paymentId: pid, amount, outcome: "captured", periodDays: days }));
    } else {
      await ingestSandbox(sandboxEvent("payment.failed", { subscriptionId: checkout.providerSubscriptionId, paymentId: pid, amount, outcome: "failed" }));
      await ingestSandbox(sandboxEvent("subscription.pending", { subscriptionId: checkout.providerSubscriptionId }));
      checkout.status = "failed"; await checkout.save();
    }
    return NextResponse.json({ ok: true, notice: "Sandbox result recorded. No real money was moved." });
  } catch (error) {
    return err(error instanceof Error ? error.message : "Sandbox action failed");
  }
}
