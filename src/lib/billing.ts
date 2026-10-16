import { createHash, randomBytes } from "node:crypto";
import type { Types } from "mongoose";
import { BillingCheckout, Coupon, CouponRedemption, BillingInvoice, BillingPayment, BillingWebhookEvent, Organization, PlatformSettings, SaaSSubscription } from "./saas-models";
import { computeInvoice, isStaleEvent, sign, verifySignature } from "./saas";
import { audit, currentPlan, getSettings, snapshotOf } from "./saas-server";
import { evaluateReferral } from "./referrals";
import { notifyOrg } from "./saas-notify";

type Id = Types.ObjectId | string;
export type Mode = "live" | "sandbox";

// ── Provider configuration & abstraction ──
export type ProviderConfig = { provider: "razorpay" | "sandbox"; mode: Mode; keyId?: string; keySecret?: string; webhookSecret: string; configured: boolean; usable: boolean };
export function providerConfig(): ProviderConfig {
  const keyId = process.env.RAZORPAY_KEY_ID, keySecret = process.env.RAZORPAY_KEY_SECRET, webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (keyId && keySecret && webhookSecret) return { provider: "razorpay", mode: keyId.startsWith("rzp_live_") ? "live" : "sandbox", keyId, keySecret, webhookSecret, configured: true, usable: true };
  // Local sandbox: no money moves. Disabled in production unless explicitly enabled.
  const derived = createHash("sha256").update(`sandbox:${process.env.SESSION_SECRET ?? ""}`).digest("hex");
  return { provider: "sandbox", mode: "sandbox", webhookSecret: process.env.SANDBOX_WEBHOOK_SECRET || derived, configured: false, usable: process.env.NODE_ENV !== "production" || process.env.ALLOW_BILLING_SANDBOX === "1" };
}

export type CreatedSubscription = { providerSubscriptionId: string; checkoutUrl: string };
export interface BillingProvider {
  name: string;
  createSubscription(input: { checkoutId: string; organizationId: string; planKey: string; interval: "monthly" | "annual"; providerPlanId?: string; offerId?: string }): Promise<CreatedSubscription>;
  cancelSubscription(providerSubscriptionId: string, atCycleEnd: boolean): Promise<void>;
}

class RazorpayProvider implements BillingProvider {
  name = "razorpay";
  constructor(private cfg: ProviderConfig) {}
  private async call(path: string, body: unknown) {
    const response = await fetch(`https://api.razorpay.com/v1${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Basic ${Buffer.from(`${this.cfg.keyId}:${this.cfg.keySecret}`).toString("base64")}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const json = (await response.json().catch(() => ({}))) as { error?: { description?: string } } & Record<string, unknown>;
    if (!response.ok) throw new Error(json.error?.description || "The payment gateway rejected the request");
    return json;
  }
  async createSubscription(i: Parameters<BillingProvider["createSubscription"]>[0]) {
    if (!i.providerPlanId) throw new Error("This plan is not linked to the payment gateway yet. Contact support.");
    const json = await this.call("/subscriptions", { plan_id: i.providerPlanId, total_count: i.interval === "annual" ? 10 : 120, quantity: 1, customer_notify: 1, notes: { checkoutId: i.checkoutId, organizationId: i.organizationId, planKey: i.planKey }, ...(i.offerId ? { offer_id: i.offerId } : {}) });
    if (typeof json.id !== "string" || typeof json.short_url !== "string") throw new Error("The payment gateway returned an unexpected response");
    return { providerSubscriptionId: json.id, checkoutUrl: json.short_url };
  }
  async cancelSubscription(id: string, atCycleEnd: boolean) { await this.call(`/subscriptions/${encodeURIComponent(id)}/cancel`, { cancel_at_cycle_end: atCycleEnd ? 1 : 0 }); }
}
class SandboxProvider implements BillingProvider {
  name = "sandbox";
  async createSubscription(i: Parameters<BillingProvider["createSubscription"]>[0]) {
    return { providerSubscriptionId: `sandbox_sub_${randomBytes(8).toString("hex")}`, checkoutUrl: `/billing/sandbox/${i.checkoutId}` };
  }
  async cancelSubscription(id: string, atCycleEnd: boolean) {
    await ingestSandbox(sandboxEvent("subscription.cancelled", { subscriptionId: id, atCycleEnd }));
  }
}
export function getProvider(): BillingProvider {
  const cfg = providerConfig();
  if (cfg.provider === "razorpay") return new RazorpayProvider(cfg);
  if (!cfg.usable) throw new Error("Billing is not configured. Set Razorpay credentials to accept payments.");
  return new SandboxProvider();
}

// ── Sandbox event construction (Razorpay-shaped, signed with the sandbox secret, ingested via the real path) ──
type SandboxInput = { subscriptionId: string; paymentId?: string; amount?: number; outcome?: "captured" | "failed"; atCycleEnd?: boolean; periodDays?: number; at?: Date; refundId?: string };
export function sandboxEvent(type: string, i: SandboxInput) {
  const at = i.at ?? new Date();
  const start = Math.floor(at.getTime() / 1000), end = start + (i.periodDays ?? 30) * 86400;
  const body: Record<string, unknown> = { entity: "event", event: type, created_at: start, payload: { subscription: { entity: { id: i.subscriptionId, status: type.split(".")[1], current_start: start, current_end: end } } } };
  if (i.paymentId) (body.payload as Record<string, unknown>).payment = { entity: { id: i.paymentId, amount: i.amount ?? 0, status: i.outcome ?? "captured", method: "sandbox", error_description: i.outcome === "failed" ? "Sandbox: simulated card decline" : undefined } };
  if (i.refundId) (body.payload as Record<string, unknown>).refund = { entity: { id: i.refundId, payment_id: i.paymentId, amount: i.amount ?? 0 } };
  return { raw: JSON.stringify(body), eventId: `sbx_evt_${randomBytes(8).toString("hex")}` };
}
export async function ingestSandbox(e: { raw: string; eventId: string }) {
  const cfg = providerConfig();
  if (cfg.provider !== "sandbox" || !cfg.usable) throw new Error("Sandbox billing is not available");
  return ingestWebhook(e.raw, sign(e.raw, cfg.webhookSecret), e.eventId);
}

// ── Webhook ingestion ──
type Entity = Record<string, unknown>;
type Parsed = { type: string; at: Date; subscription?: Entity; payment?: Entity; refund?: Entity };
function parse(raw: string): Parsed {
  const body = JSON.parse(raw) as { event?: string; created_at?: number; payload?: Record<string, { entity?: Entity }> };
  if (!body.event) throw new Error("Malformed event");
  return { type: body.event, at: new Date((body.created_at ?? Math.floor(Date.now() / 1000)) * 1000), subscription: body.payload?.subscription?.entity, payment: body.payload?.payment?.entity, refund: body.payload?.refund?.entity };
}

/** Verifies the signature over the raw body, de-duplicates by event id, then processes idempotently. */
export async function ingestWebhook(raw: string, signature: string | null, eventId: string | null) {
  const cfg = providerConfig();
  if (!verifySignature(raw, signature, cfg.webhookSecret)) return { status: 400 as const, error: "Invalid signature" };
  let event: Parsed;
  try { event = parse(raw); } catch { return { status: 400 as const, error: "Malformed event" }; }
  const id = eventId || `body_${createHash("sha256").update(raw).digest("hex").slice(0, 32)}`;
  try {
    await BillingWebhookEvent.create({ provider: cfg.provider, eventId: id, type: event.type, mode: cfg.mode, providerCreatedAt: event.at, payload: JSON.parse(raw), status: "processing", attempts: 1 });
  } catch (e) {
    if ((e as { code?: number }).code !== 11000) throw e;
    const existing = await BillingWebhookEvent.findOneAndUpdate({ provider: cfg.provider, eventId: id, status: { $in: ["failed", "received"] } }, { status: "processing", $inc: { attempts: 1 } }, { new: true });
    if (!existing) return { status: 200 as const, duplicate: true };
  }
  try {
    const outcome = await applyEvent(event, cfg.provider, cfg.mode);
    await BillingWebhookEvent.updateOne({ provider: cfg.provider, eventId: id }, { status: outcome === "ignored" ? "ignored" : "processed", processedAt: new Date(), error: undefined });
    return { status: 200 as const, outcome };
  } catch (error) {
    await BillingWebhookEvent.updateOne({ provider: cfg.provider, eventId: id }, { status: "failed", error: error instanceof Error ? error.message.slice(0, 300) : "error" });
    return { status: 500 as const, error: "Processing failed; the provider should retry" };
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const sec = (v: unknown) => (num(v) ? new Date(num(v) * 1000) : undefined);

async function nextInvoiceNumber() {
  const s = await PlatformSettings.findOneAndUpdate({ key: "default" }, { $inc: { invoiceSeq: 1 }, $setOnInsert: { key: "default" } }, { upsert: true, new: true }).lean<{ invoiceSeq: number; invoicePrefix: string }>();
  return `${s!.invoicePrefix}-${new Date().getUTCFullYear()}-${String(s!.invoiceSeq).padStart(6, "0")}`;
}

/** Switches the organization to the checked-out plan once the provider confirms it. */
async function activateCheckout(subDoc: InstanceType<typeof SaaSSubscription>, providerSubId: string, at: Date, provider: string, mode: Mode, period?: { start?: Date; end?: Date }) {
  const checkout = await BillingCheckout.findOne({ providerSubscriptionId: providerSubId });
  const old = subDoc.providerSubscriptionId && subDoc.providerSubscriptionId !== providerSubId ? subDoc.providerSubscriptionId : null;
  if (checkout) {
    const plan = await currentPlan(checkout.planKey);
    const versioned = plan && plan.version === checkout.planVersion ? plan : await import("./saas-models").then((m) => m.SaaSPlan.findOne({ key: checkout.planKey, version: checkout.planVersion }).lean<NonNullable<typeof plan>>());
    if (versioned) { subDoc.planKey = versioned.key; subDoc.planVersion = versioned.version; subDoc.planSnapshot = snapshotOf(versioned); }
    subDoc.interval = checkout.interval; subDoc.couponCode = checkout.couponCode ?? undefined;
    checkout.status = "completed"; await checkout.save();
    if (checkout.couponCode) {
      const coupon = await Coupon.findOne({ code: checkout.couponCode });
      if (coupon) {
        const r = await CouponRedemption.updateOne({ couponId: coupon._id, organizationId: checkout.organizationId }, { $setOnInsert: { code: coupon.code } }, { upsert: true });
        if (r.upsertedCount) await Coupon.updateOne({ _id: coupon._id }, { $inc: { redemptions: 1 } });
      }
    }
  }
  subDoc.providerSubscriptionId = providerSubId; subDoc.provider = provider as "razorpay" | "sandbox"; subDoc.mode = mode; subDoc.source = "provider";
  subDoc.status = "active"; subDoc.pastDueSince = undefined; subDoc.cancelAtPeriodEnd = false; subDoc.canceledAt = undefined;
  subDoc.currentPeriodStart = period?.start ?? at;
  subDoc.currentPeriodEnd = period?.end ?? new Date(at.getTime() + (subDoc.interval === "annual" ? 365 : 30) * 86400000);
  subDoc.trialEnd = subDoc.status === "active" ? subDoc.trialEnd : undefined;
  subDoc.history.push({ at, status: "active", planKey: subDoc.planKey, reason: "Verified payment" } as never);
  return old;
}

async function applyEvent(ev: Parsed, provider: string, mode: Mode): Promise<"applied" | "ignored"> {
  const sub = ev.subscription ?? {};
  const pay = ev.payment ?? {};
  const providerSubId = str(sub.id) || str((pay.notes as Entity | undefined)?.providerSubscriptionId) || str(pay.subscription_id);
  let subscription = providerSubId ? await SaaSSubscription.findOne({ providerSubscriptionId: providerSubId }) : null;
  const checkout = providerSubId ? await BillingCheckout.findOne({ providerSubscriptionId: providerSubId }) : null;
  if (!subscription && checkout) subscription = await SaaSSubscription.findOne({ organizationId: checkout.organizationId });
  if (!subscription && !checkout && ev.refund) {
    const p = await BillingPayment.findOne({ provider, providerPaymentId: str(ev.refund.payment_id) });
    if (p) subscription = await SaaSSubscription.findOne({ organizationId: p.organizationId });
  }
  if (!subscription) {
    const orgId = str((pay.notes as Entity | undefined)?.organizationId);
    if (orgId) subscription = await SaaSSubscription.findOne({ organizationId: orgId });
  }
  if (!subscription) {
    if (type0(ev) === "subscription.cancelled" || type0(ev) === "subscription.completed") return "ignored";
    throw new Error("Event does not match any subscription yet");
  }
  void checkout;
  const orgId = subscription.organizationId as Id;
  const settings = await getSettings();
  const stale = isStaleEvent(subscription.lastProviderEventAt, ev.at);
  const type = ev.type;

  // Payments and invoices are applied idempotently regardless of ordering.
  if ((type === "subscription.charged" || type === "payment.captured") && str(pay.id)) {
    const amount = num(pay.amount);
    const exists = await BillingPayment.findOne({ provider, providerPaymentId: str(pay.id) });
    if (!exists) {
      const plan = subscription.planSnapshot as { name: string; monthlyPaise: number; annualPaise: number };
      const checkoutPlan = checkout ? await currentPlan(checkout.planKey) : null;
      const list = checkoutPlan ? (checkout!.interval === "annual" ? checkoutPlan.annualPaise : checkoutPlan.monthlyPaise) : subscription.interval === "annual" ? plan.annualPaise : plan.monthlyPaise;
      const discount = list > amount ? list - amount : 0;
      const taxed = computeInvoice({ subtotalPaise: amount, tax: { mode: settings.taxMode === "none" ? "none" : "inclusive", rateBps: settings.taxRateBps } }); // the gateway amount is what was charged, so tax is decomposed from it
      const invoice = await BillingInvoice.create({
        organizationId: orgId, subscriptionId: subscription._id, number: await nextInvoiceNumber(), providerPaymentId: str(pay.id), mode, planKey: checkout?.planKey ?? subscription.planKey,
        periodStart: sec(sub.current_start), periodEnd: sec(sub.current_end),
        lineItems: [{ description: `${checkoutPlan?.name ?? plan.name} plan (${checkout?.interval ?? subscription.interval})`, amountPaise: discount ? list : amount }, ...(discount ? [{ description: "Discount", amountPaise: -discount }] : [])],
        subtotalPaise: amount + discount, discountPaise: discount, taxMode: taxed.taxMode, taxRateBps: taxed.taxRateBps, taxPaise: taxed.taxPaise, totalPaise: amount, amountPaidPaise: amount, status: "paid", paidAt: ev.at,
      });
      await BillingPayment.create({ organizationId: orgId, invoiceId: invoice._id, provider, providerPaymentId: str(pay.id), providerSubscriptionId: providerSubId, amountPaise: amount, status: "captured", method: str(pay.method), mode, capturedAt: ev.at, lastEventAt: ev.at });
      await evaluateReferral(orgId, mode === "live" && amount > 0);
    }
  }
  if (type === "payment.failed" && str(pay.id)) {
    const amount = num(pay.amount);
    const exists = await BillingPayment.findOne({ provider, providerPaymentId: str(pay.id) });
    if (!exists) {
      const plan = subscription.planSnapshot as { name: string };
      const invoice = await BillingInvoice.create({ organizationId: orgId, subscriptionId: subscription._id, number: await nextInvoiceNumber(), providerPaymentId: str(pay.id), mode, planKey: subscription.planKey, lineItems: [{ description: `${plan.name} plan`, amountPaise: amount }], subtotalPaise: amount, totalPaise: amount, status: "failed", failureReason: str(pay.error_description) || "Payment failed" });
      await BillingPayment.create({ organizationId: orgId, invoiceId: invoice._id, provider, providerPaymentId: str(pay.id), providerSubscriptionId: providerSubId, amountPaise: amount, status: "failed", mode, failureReason: str(pay.error_description) || "Payment failed", lastEventAt: ev.at });
    }
  }
  if ((type === "refund.processed" || type === "payment.refunded") && ev.refund) {
    const p = await BillingPayment.findOne({ provider, providerPaymentId: str(ev.refund.payment_id) });
    if (!p) throw new Error("Refund arrived before its payment; will retry");
    const refunded = Math.min(p.amountPaise, p.refundedPaise + num(ev.refund.amount));
    p.refundedPaise = refunded; p.status = refunded >= p.amountPaise ? "refunded" : "partially_refunded"; await p.save();
    if (p.invoiceId) await BillingInvoice.updateOne({ _id: p.invoiceId }, { refundedPaise: refunded, status: refunded >= p.amountPaise ? "refunded" : "partially_refunded" });
  }

  // Lifecycle changes only move forward in provider time.
  if (stale && ["subscription.activated", "subscription.charged", "subscription.pending", "subscription.halted", "subscription.cancelled", "subscription.completed"].includes(type)) {
    await subscription.save();
    return "ignored";
  }
  let oldProviderSub: string | null = null;
  if (type === "subscription.activated" || type === "subscription.charged") {
    oldProviderSub = await activateCheckout(subscription, providerSubId, ev.at, provider, mode, { start: sec(sub.current_start), end: sec(sub.current_end) });
  } else if (type === "subscription.pending" || type === "subscription.halted") {
    if (subscription.providerSubscriptionId === providerSubId && subscription.status !== "canceled") {
      subscription.status = "past_due"; subscription.pastDueSince ??= ev.at;
      subscription.history.push({ at: ev.at, status: "past_due", planKey: subscription.planKey, reason: "Payment failed" } as never);
    }
  } else if (type === "subscription.cancelled" || type === "subscription.completed") {
    if (subscription.providerSubscriptionId === providerSubId) {
      subscription.status = "canceled"; subscription.canceledAt = ev.at; subscription.cancelAtPeriodEnd = false;
      if (num(sub.current_end)) subscription.currentPeriodEnd = sec(sub.current_end);
      subscription.history.push({ at: ev.at, status: "canceled", planKey: subscription.planKey, reason: type === "subscription.completed" ? "Term completed" : "Canceled" } as never);
    } else if (checkout) { checkout.status = "abandoned"; await checkout.save(); }
  } else if (type === "payment.failed") {
    // Retry messaging is created by the job runner from failed invoices; lifecycle waits for subscription.pending/halted.
  } else if (!["subscription.charged", "payment.captured", "refund.processed", "payment.refunded", "subscription.authenticated"].includes(type)) {
    return "ignored";
  }
  subscription.lastProviderEventAt = ev.at;
  await subscription.save();
  if (oldProviderSub) { try { const p = getProviderSafe(); if (p) await p.cancelSubscription(oldProviderSub, false); } catch { /* old subscription is canceled out of band if the gateway call fails */ } }
  if (type === "subscription.activated" || type === "subscription.charged" || type === "subscription.cancelled" || type === "subscription.pending" || type === "subscription.halted")
    await audit({ organizationId: orgId, actorId: orgId, actorRole: "system", action: `billing.${type}`, targetType: "subscription", targetId: String(subscription._id) });
  const copy: Record<string, [string, string]> = {
    "subscription.activated": ["Subscription active", `Your ${(subscription.planSnapshot as { name: string }).name} plan is active.`],
    "subscription.charged": ["Payment received", "Your subscription payment was confirmed."],
    "subscription.cancelled": ["Subscription canceled", "Paid features continue until the end of the current period."],
    "subscription.pending": ["Payment failed", "We could not collect your subscription payment. Update your payment method from Billing."],
    "subscription.halted": ["Subscription paused after failed payments", "Update your payment method from Billing to restore paid features."],
  };
  if (copy[type]) await notifyOrg({ organizationId: orgId, key: `status:${subscription._id}:${type}:${ev.at.getTime()}`, kind: "subscription", title: copy[type][0], message: copy[type][1] }).catch(() => null);
  void Organization;
  return "applied";
}
const type0 = (e: Parsed) => e.type;
function getProviderSafe() { try { return getProvider(); } catch { return null; } }

/** Re-runs a stored failed event (admin retry). The payload was verified when first received. */
export async function reprocessEvent(eventId: string) {
  const stored = await BillingWebhookEvent.findOne({ _id: eventId, status: { $in: ["failed", "received"] } });
  if (!stored) throw new Error("Event not found or already processed");
  stored.status = "processing"; stored.attempts += 1; await stored.save();
  try {
    const outcome = await applyEvent(parse(JSON.stringify(stored.payload)), stored.provider, stored.mode as Mode);
    stored.status = outcome === "ignored" ? "ignored" : "processed"; stored.processedAt = new Date(); stored.error = undefined; await stored.save();
    return outcome;
  } catch (error) {
    stored.status = "failed"; stored.error = error instanceof Error ? error.message.slice(0, 300) : "error"; await stored.save();
    throw error;
  }
}
