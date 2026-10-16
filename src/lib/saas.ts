import { createHmac, timingSafeEqual } from "node:crypto";

export const FEATURES = {
  basic: "Basic library management",
  "fees-expenses": "Fee and expense management",
  crm: "Admission CRM",
  "qr-attendance": "QR attendance",
  "advanced-reports": "Advanced reporting",
  "multi-branch": "Multi-branch access",
  "advanced-controls": "Advanced controls",
} as const;
export type FeatureKey = keyof typeof FEATURES;

export type PlanSeed = { key: string; name: string; description: string; monthlyPaise: number; annualPaise: number; trialDays: number; limits: { activeStudents: number; branches: number }; features: FeatureKey[]; sortOrder: number };
/** Proposed defaults. They are only seed values: live plans are read from the database and edited by platform admins. */
export const DEFAULT_PLANS: PlanSeed[] = [
  { key: "free", name: "Free", description: "Run a small library with the essentials.", monthlyPaise: 0, annualPaise: 0, trialDays: 0, limits: { activeStudents: 25, branches: 1 }, features: ["basic"], sortOrder: 0 },
  { key: "starter", name: "Starter", description: "Add fee and expense management.", monthlyPaise: 29900, annualPaise: 299000, trialDays: 0, limits: { activeStudents: 100, branches: 1 }, features: ["basic", "fees-expenses", "crm"], sortOrder: 1 },
  { key: "pro", name: "Pro", description: "QR attendance and advanced reporting.", monthlyPaise: 59900, annualPaise: 599000, trialDays: 14, limits: { activeStudents: 300, branches: 1 }, features: ["basic", "fees-expenses", "crm", "qr-attendance", "advanced-reports"], sortOrder: 2 },
  { key: "business", name: "Business", description: "Multiple branches with advanced controls.", monthlyPaise: 129900, annualPaise: 1299000, trialDays: 0, limits: { activeStudents: 2000, branches: 10 }, features: ["basic", "fees-expenses", "crm", "qr-attendance", "advanced-reports", "multi-branch", "advanced-controls"], sortOrder: 3 },
];

export type PlanSnapshot = { name: string; monthlyPaise: number; annualPaise: number; limits: { activeStudents: number; branches: number }; features: string[] };
export type Overrides = { features?: { add?: string[]; remove?: string[] }; limits?: { activeStudents?: number; branches?: number }; expiresAt?: Date | string | null; reason?: string };
export type SubLike = {
  status: "trialing" | "active" | "past_due" | "canceled" | "expired";
  trialEnd?: Date | null; currentPeriodEnd?: Date | null; pastDueSince?: Date | null;
  planSnapshot: PlanSnapshot; overrides?: Overrides | null;
};
export type Entitlements = { tier: "plan" | "free"; restricted: boolean; reason: string; features: string[]; limits: { activeStudents: number; branches: number }; planName: string; accessUntil?: Date | null };

const day = 86400000;

/**
 * What an organization may use right now. Expired access falls back to the free plan:
 * data is never deleted, and exports stay available.
 */
export function resolveEntitlements(sub: SubLike | null, free: PlanSnapshot, now: Date, graceDays: number): Entitlements {
  const fallback = (reason: string): Entitlements => ({ tier: "free", restricted: true, reason, features: [...free.features], limits: { ...free.limits }, planName: free.name });
  let result: Entitlements;
  if (!sub) result = fallback("No subscription — free plan limits apply");
  else {
    const plan = sub.planSnapshot;
    const full = (reason: string, until?: Date | null): Entitlements => ({ tier: "plan", restricted: false, reason, features: [...plan.features], limits: { ...plan.limits }, planName: plan.name, accessUntil: until ?? null });
    const t = (v?: Date | null) => (v ? new Date(v).getTime() : 0);
    if (sub.status === "trialing") result = t(sub.trialEnd) > now.getTime() ? full("Trial active", sub.trialEnd) : fallback("Trial ended — free plan limits apply");
    else if (sub.status === "active") {
      const end = sub.currentPeriodEnd ? t(sub.currentPeriodEnd) : Infinity;
      result = end + graceDays * day > now.getTime() ? full(end > now.getTime() ? "Active" : "Renewal grace period", sub.currentPeriodEnd) : fallback("Subscription lapsed — free plan limits apply");
    } else if (sub.status === "past_due") {
      const since = sub.pastDueSince ? t(sub.pastDueSince) : t(sub.currentPeriodEnd);
      result = since + graceDays * day > now.getTime() ? full("Payment failed — grace period", new Date(since + graceDays * day)) : fallback("Payment failed and grace period ended");
    } else if (sub.status === "canceled") result = t(sub.currentPeriodEnd) > now.getTime() ? full("Canceled — access until period end", sub.currentPeriodEnd) : fallback("Subscription ended");
    else result = fallback("Subscription expired");
  }
  const o = sub?.overrides;
  if (o && (!o.expiresAt || new Date(o.expiresAt).getTime() > now.getTime())) {
    const features = new Set(result.features);
    o.features?.add?.forEach((f) => features.add(f));
    o.features?.remove?.forEach((f) => features.delete(f));
    result = { ...result, features: [...features], limits: { activeStudents: o.limits?.activeStudents ?? result.limits.activeStudents, branches: o.limits?.branches ?? result.limits.branches }, restricted: result.restricted && !(o.features?.add?.length || o.limits) };
  }
  return result;
}

export const hasFeature = (e: Entitlements, feature: string) => e.features.includes(feature);
export const withinLimit = (used: number, limit: number, adding = 1) => used + adding <= limit;

// ── Invoices ──
export type TaxConfig = { mode: "none" | "inclusive" | "exclusive"; rateBps: number };
/** All amounts in integer paise. Tax is never assumed: mode "none" means no tax is shown or added. */
export function computeInvoice(input: { subtotalPaise: number; discountPaise?: number; tax: TaxConfig }) {
  const subtotal = Math.max(0, Math.round(input.subtotalPaise));
  const discount = Math.min(subtotal, Math.max(0, Math.round(input.discountPaise ?? 0)));
  const net = subtotal - discount;
  const { mode, rateBps } = input.tax;
  let tax = 0, total = net;
  if (mode === "exclusive") { tax = Math.round((net * rateBps) / 10000); total = net + tax; }
  else if (mode === "inclusive") tax = net - Math.round((net * 10000) / (10000 + rateBps));
  return { subtotalPaise: subtotal, discountPaise: discount, taxPaise: tax, totalPaise: total, taxMode: mode, taxRateBps: mode === "none" ? 0 : rateBps };
}

export function couponDiscount(coupon: { type: "percent" | "fixed"; value: number }, amountPaise: number) {
  const raw = coupon.type === "percent" ? Math.round((amountPaise * Math.min(coupon.value, 100)) / 100) : coupon.value;
  return Math.min(amountPaise, Math.max(0, raw));
}
export function couponUsable(c: { active: boolean; validFrom?: Date | null; validTo?: Date | null; maxRedemptions: number; redemptions: number; plans?: string[] }, planKey: string, now: Date) {
  if (!c.active) return "This code is not active";
  if (c.validFrom && new Date(c.validFrom) > now) return "This code is not valid yet";
  if (c.validTo && new Date(c.validTo) < now) return "This code has expired";
  if (c.redemptions >= c.maxRedemptions) return "This code has been fully redeemed";
  if (c.plans?.length && !c.plans.includes(planKey)) return "This code does not apply to that plan";
  return null;
}

// ── Metrics (documented formulas) ──
export const monthlyEquivalent = (s: { interval: "monthly" | "annual"; planSnapshot: { monthlyPaise: number; annualPaise: number } }) =>
  s.interval === "annual" ? Math.round(s.planSnapshot.annualPaise / 12) : s.planSnapshot.monthlyPaise;

type HistoryEntry = { at: Date | string; status: string };
/** Whether a subscription was in a revenue-generating state at a point in time, from its status history. */
export function payingAt(history: HistoryEntry[], when: Date, paidSource: boolean) {
  if (!paidSource) return false;
  const past = history.filter((h) => new Date(h.at) <= when).sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const last = past[past.length - 1];
  return !!last && (last.status === "active" || last.status === "past_due");
}
export const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

// ── Referral abuse checks ──
export function referralVerdict(input: { referrerOrgId: string; referredOrgId: string; referrerOwnerId: string; referredOwnerId: string; referrerEmail: string; referredEmail: string; alreadyReferred: boolean; rewardedThisMonth: number; monthlyCap: number }) {
  if (input.referrerOrgId === input.referredOrgId || input.referrerOwnerId === input.referredOwnerId) return "Self-referrals are not allowed";
  const domain = (e: string) => e.split("@")[1] ?? "";
  const personal = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];
  if (domain(input.referrerEmail) && domain(input.referrerEmail) === domain(input.referredEmail) && !personal.includes(domain(input.referrerEmail))) return "Referrer and referred accounts share a business domain";
  if (input.alreadyReferred) return "This organization has already been referred";
  if (input.rewardedThisMonth >= input.monthlyCap) return "Monthly referral reward limit reached";
  return null;
}

// ── Webhooks ──
export function verifySignature(rawBody: string, signature: string | null, secret: string) {
  if (!signature || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected), b = Buffer.from(signature.trim());
  return a.length === b.length && timingSafeEqual(a, b);
}
export const sign = (rawBody: string, secret: string) => createHmac("sha256", secret).update(rawBody).digest("hex");

/** Out-of-order guard: lifecycle state only moves forward in provider time. */
export const isStaleEvent = (lastAppliedAt: Date | null | undefined, eventAt: Date) => !!lastAppliedAt && eventAt.getTime() < new Date(lastAppliedAt).getTime();

// ── CRM ──
export function normalizePhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}
export function leadKey(phone: string, email: string) {
  const p = normalizePhone(phone);
  return p.length >= 10 ? `p:${p}` : email ? `e:${email.toLowerCase().trim()}` : "";
}
const leadFlow: Record<string, string[]> = { new: ["contacted", "visit-scheduled", "lost"], contacted: ["visit-scheduled", "converted", "lost"], "visit-scheduled": ["contacted", "converted", "lost"], converted: [], lost: ["new", "contacted"] };
export const canMoveLead = (from: string, to: string) => leadFlow[from]?.includes(to) ?? false;

// ── CSV ──
export function parseStudentCsv(text: string, max = 500) {
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: [{ line: 0, error: "File is empty" }] };
  const split = (l: string) => l.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
  const header = split(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  if (col("name") < 0 || col("email") < 0) return { rows: [], errors: [{ line: 1, error: "Header must include name and email" }] };
  const rows: { name: string; email: string; phone: string }[] = [], errors: { line: number; error: string }[] = [], seen = new Set<string>();
  lines.slice(1, max + 1).forEach((l, i) => {
    const c = split(l), name = c[col("name")] ?? "", email = (c[col("email")] ?? "").toLowerCase(), phone = col("phone") >= 0 ? c[col("phone")] ?? "" : "";
    if (name.length < 2 || name.length > 80) return errors.push({ line: i + 2, error: "Name must be 2-80 characters" });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errors.push({ line: i + 2, error: "Invalid email" });
    if (seen.has(email)) return errors.push({ line: i + 2, error: "Duplicate email in file" });
    seen.add(email); rows.push({ name, email, phone: phone.slice(0, 20) });
  });
  if (lines.length - 1 > max) errors.push({ line: max + 2, error: `Only the first ${max} rows are imported` });
  return { rows, errors };
}
