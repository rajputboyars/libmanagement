import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PLANS, canMoveLead, computeInvoice, couponDiscount, couponUsable, isStaleEvent, leadKey, monthlyEquivalent, parseStudentCsv, payingAt, rate, referralVerdict, resolveEntitlements, sign, verifySignature, withinLimit } from "../src/lib/saas";

const snap = (key: string) => { const p = DEFAULT_PLANS.find((x) => x.key === key)!; return { name: p.name, monthlyPaise: p.monthlyPaise, annualPaise: p.annualPaise, limits: p.limits, features: p.features as string[] }; };
const free = snap("free");
const now = new Date("2026-06-15T00:00:00Z");
const d = (s: string) => new Date(s);

describe("Default plans", () => {
  it("match the proposed prices, limits and features", () => {
    const by = Object.fromEntries(DEFAULT_PLANS.map((p) => [p.key, p]));
    assert.deepEqual([by.free.monthlyPaise, by.starter.monthlyPaise, by.pro.monthlyPaise, by.business.monthlyPaise], [0, 29900, 59900, 129900]);
    assert.deepEqual([by.free.limits.activeStudents, by.starter.limits.activeStudents, by.pro.limits.activeStudents], [25, 100, 300]);
    assert.ok(by.pro.features.includes("qr-attendance") && by.pro.features.includes("advanced-reports"));
    assert.ok(!by.pro.features.includes("multi-branch") && by.business.features.includes("multi-branch"));
    assert.ok(!by.free.features.includes("fees-expenses") && by.starter.features.includes("fees-expenses"));
  });
});

describe("Entitlement engine", () => {
  const pro = snap("pro");
  it("grants plan access during an active trial and falls back to free after it", () => {
    const base = { status: "trialing" as const, planSnapshot: pro };
    assert.equal(resolveEntitlements({ ...base, trialEnd: d("2026-06-20") }, free, now, 7).tier, "plan");
    const ended = resolveEntitlements({ ...base, trialEnd: d("2026-06-01") }, free, now, 7);
    assert.equal(ended.tier, "free"); assert.equal(ended.limits.activeStudents, 25); assert.ok(!ended.features.includes("qr-attendance"));
  });
  it("keeps paid access through the grace period, then restricts", () => {
    const active = { status: "active" as const, planSnapshot: pro, currentPeriodEnd: d("2026-06-10") };
    assert.equal(resolveEntitlements(active, free, now, 7).tier, "plan"); // 5 days past end, within 7
    assert.equal(resolveEntitlements(active, free, now, 3).tier, "free");
  });
  it("handles past-due and canceled states", () => {
    assert.equal(resolveEntitlements({ status: "past_due", planSnapshot: pro, pastDueSince: d("2026-06-12") }, free, now, 7).tier, "plan");
    assert.equal(resolveEntitlements({ status: "past_due", planSnapshot: pro, pastDueSince: d("2026-06-01") }, free, now, 7).tier, "free");
    assert.equal(resolveEntitlements({ status: "canceled", planSnapshot: pro, currentPeriodEnd: d("2026-06-30") }, free, now, 7).tier, "plan");
    assert.equal(resolveEntitlements({ status: "canceled", planSnapshot: pro, currentPeriodEnd: d("2026-06-01") }, free, now, 7).tier, "free");
    assert.equal(resolveEntitlements({ status: "expired", planSnapshot: pro }, free, now, 7).tier, "free");
  });
  it("applies unexpired admin overrides only", () => {
    const sub = { status: "expired" as const, planSnapshot: pro, overrides: { features: { add: ["qr-attendance"] }, limits: { activeStudents: 60 }, expiresAt: d("2026-07-01") } };
    const e = resolveEntitlements(sub, free, now, 7);
    assert.ok(e.features.includes("qr-attendance")); assert.equal(e.limits.activeStudents, 60);
    const lapsed = resolveEntitlements({ ...sub, overrides: { ...sub.overrides, expiresAt: d("2026-06-01") } }, free, now, 7);
    assert.ok(!lapsed.features.includes("qr-attendance")); assert.equal(lapsed.limits.activeStudents, 25);
  });
  it("enforces limits inclusively", () => {
    assert.equal(withinLimit(24, 25), true); assert.equal(withinLimit(25, 25), false); assert.equal(withinLimit(20, 25, 5), true); assert.equal(withinLimit(20, 25, 6), false);
  });
});

describe("Invoice calculation", () => {
  it("adds no tax unless configured", () => {
    assert.deepEqual(computeInvoice({ subtotalPaise: 59900, tax: { mode: "none", rateBps: 1800 } }), { subtotalPaise: 59900, discountPaise: 0, taxPaise: 0, totalPaise: 59900, taxMode: "none", taxRateBps: 0 });
  });
  it("computes exclusive and inclusive tax from configuration", () => {
    const ex = computeInvoice({ subtotalPaise: 59900, discountPaise: 9900, tax: { mode: "exclusive", rateBps: 1800 } });
    assert.deepEqual([ex.taxPaise, ex.totalPaise], [9000, 59000]);
    const inc = computeInvoice({ subtotalPaise: 11800, tax: { mode: "inclusive", rateBps: 1800 } });
    assert.deepEqual([inc.taxPaise, inc.totalPaise], [1800, 11800]);
  });
  it("never lets a discount exceed the subtotal", () => {
    assert.equal(computeInvoice({ subtotalPaise: 1000, discountPaise: 5000, tax: { mode: "none", rateBps: 0 } }).totalPaise, 0);
  });
});

describe("Coupons", () => {
  it("computes percent and fixed discounts, capped at the amount", () => {
    assert.equal(couponDiscount({ type: "percent", value: 25 }, 59900), 14975);
    assert.equal(couponDiscount({ type: "fixed", value: 99900 }, 59900), 59900);
  });
  it("rejects inactive, expired, exhausted and wrong-plan codes", () => {
    const ok = { active: true, maxRedemptions: 2, redemptions: 1, plans: ["pro"] };
    assert.equal(couponUsable(ok, "pro", now), null);
    assert.ok(couponUsable({ ...ok, active: false }, "pro", now));
    assert.ok(couponUsable({ ...ok, validTo: d("2026-01-01") }, "pro", now));
    assert.ok(couponUsable({ ...ok, redemptions: 2 }, "pro", now));
    assert.ok(couponUsable(ok, "starter", now));
  });
});

describe("Webhook security and ordering", () => {
  it("verifies HMAC signatures over the exact raw body", () => {
    const body = JSON.stringify({ event: "payment.captured" });
    assert.equal(verifySignature(body, sign(body, "s3cret"), "s3cret"), true);
    assert.equal(verifySignature(body + " ", sign(body, "s3cret"), "s3cret"), false);
    assert.equal(verifySignature(body, sign(body, "other"), "s3cret"), false);
    assert.equal(verifySignature(body, null, "s3cret"), false);
    assert.equal(verifySignature(body, "short", "s3cret"), false);
  });
  it("detects stale events", () => {
    assert.equal(isStaleEvent(d("2026-06-10"), d("2026-06-09")), true);
    assert.equal(isStaleEvent(d("2026-06-10"), d("2026-06-11")), false);
    assert.equal(isStaleEvent(null, d("2026-06-11")), false);
  });
});

describe("Metrics helpers", () => {
  it("normalises annual plans to monthly revenue", () => {
    assert.equal(monthlyEquivalent({ interval: "annual", planSnapshot: { monthlyPaise: 59900, annualPaise: 599000 } }), 49917);
    assert.equal(monthlyEquivalent({ interval: "monthly", planSnapshot: { monthlyPaise: 59900, annualPaise: 599000 } }), 59900);
  });
  it("derives point-in-time paying status from history", () => {
    const h = [{ at: "2026-01-01", status: "trialing" }, { at: "2026-02-01", status: "active" }, { at: "2026-05-01", status: "canceled" }];
    assert.equal(payingAt(h, d("2026-01-15"), true), false); assert.equal(payingAt(h, d("2026-03-01"), true), true);
    assert.equal(payingAt(h, d("2026-06-01"), true), false); assert.equal(payingAt(h, d("2026-03-01"), false), false);
  });
  it("returns null rates for empty denominators", () => { assert.equal(rate(1, 0), null); assert.equal(rate(1, 3), 33.3); });
});

describe("Referral abuse prevention", () => {
  const base = { referrerOrgId: "a", referredOrgId: "b", referrerOwnerId: "u1", referredOwnerId: "u2", referrerEmail: "x@gmail.com", referredEmail: "y@gmail.com", alreadyReferred: false, rewardedThisMonth: 0, monthlyCap: 5 };
  it("accepts a clean referral", () => assert.equal(referralVerdict(base), null));
  it("blocks self, same-owner, shared business domain, repeats and cap", () => {
    assert.ok(referralVerdict({ ...base, referredOrgId: "a" }));
    assert.ok(referralVerdict({ ...base, referredOwnerId: "u1" }));
    assert.ok(referralVerdict({ ...base, referrerEmail: "a@lib.in", referredEmail: "b@lib.in" }));
    assert.ok(referralVerdict({ ...base, alreadyReferred: true }));
    assert.ok(referralVerdict({ ...base, rewardedThisMonth: 5 }));
  });
});

describe("CRM and CSV", () => {
  it("builds duplicate keys from normalised phone, else email", () => {
    assert.equal(leadKey("+91 98765-43210", ""), leadKey("9876543210", "x@y.in"));
    assert.equal(leadKey("123", "A@B.in"), "e:a@b.in"); assert.equal(leadKey("", ""), "");
  });
  it("allows only valid lead stage moves", () => {
    assert.equal(canMoveLead("new", "contacted"), true); assert.equal(canMoveLead("converted", "new"), false); assert.equal(canMoveLead("new", "converted"), false);
  });
  it("parses student CSV with row-level errors", () => {
    const r = parseStudentCsv("name,email,phone\nAsha,asha@x.in,98765\nB,bad,\nAsha Two,ASHA@x.in,\nRavi Kumar,ravi@x.in,");
    assert.equal(r.rows.length, 2); assert.equal(r.errors.length, 2);
    assert.equal(parseStudentCsv("foo,bar\n1,2").errors[0].error, "Header must include name and email");
  });
});
