import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { feeTotals, isRunning, owed, renewalTerms } from "../src/lib/fees";
import { localMinutes, onShift, seatState } from "../src/lib/seat-map";
import { DEFAULT_PLANS } from "../src/lib/saas";

const now = new Date("2026-06-15T10:00:00Z");
const day = 86400000;
const m = (over: Record<string, unknown> = {}) => ({ status: "active", start: new Date(+now - 5 * day), end: new Date(+now + 20 * day), amount: 100000, discount: 0, paid: 0, ...over });

describe("Pending fees", () => {
  it("owes amount minus discount minus paid, never below zero", () => {
    assert.equal(owed(m({ discount: 20000, paid: 30000 })), 50000);
    assert.equal(owed(m({ discount: 20000, paid: 90000 })), 0);
    assert.equal(owed({ end: now, amount: 5000 }), 5000);
  });
  it("counts only running memberships as pending", () => {
    const totals = feeTotals([
      m({ paid: 40000 }), // running: 60000 pending
      m({ status: "paused", discount: 10000 }), // paused still owes: 90000
      m({ status: "cancelled" }), // not billed
      m({ status: "expired", end: new Date(+now - day), paid: 20000 }), // ended: closed balance only
      m({ status: "active", end: new Date(+now - day) }), // lapsed but not yet marked expired
    ], now);
    assert.equal(totals.pending, 150000);
    assert.equal(totals.closedBalance, 80000 + 100000);
    assert.equal(totals.billed, 100000 + 90000 + 100000 + 100000);
    assert.equal(totals.paid, 40000 + 20000);
  });
  it("treats a missing status as active and checks the end date", () => {
    assert.equal(isRunning({ end: new Date(+now + day), amount: 1 }, now), true);
    assert.equal(isRunning({ end: new Date(+now - day), amount: 1 }, now), false);
    assert.equal(isRunning(m({ status: "cancelled" }), now), false);
  });
});

describe("Renewal price", () => {
  const plan = { amount: 100000 };
  it("repeats the previous discount unless a new one is given", () => {
    assert.deepEqual(renewalTerms(plan, 20000), { discount: 20000, payable: 80000 });
    assert.deepEqual(renewalTerms(plan, 20000, 0), { discount: 0, payable: 100000 });
    assert.deepEqual(renewalTerms(plan, undefined), { discount: 0, payable: 100000 });
  });
  it("never lets the carried discount exceed a cheaper plan, and rejects bad input", () => {
    assert.deepEqual(renewalTerms({ amount: 15000 }, 20000), { discount: 15000, payable: 0 });
    assert.throws(() => renewalTerms(plan, 0, 100001), /Discount exceeds/);
    assert.throws(() => renewalTerms(plan, 0, -1), /Discount exceeds/);
    assert.throws(() => renewalTerms(plan, 0, 10.5), /Discount exceeds/);
  });
});

describe("Seat map states", () => {
  it("reads the library clock in India time", () => {
    assert.equal(localMinutes(new Date("2026-06-15T04:30:00Z"), "Asia/Kolkata"), 10 * 60);
    assert.equal(localMinutes(new Date("2026-06-15T18:29:00Z"), "Asia/Kolkata"), 23 * 60 + 59);
    assert.equal(localMinutes(new Date("2026-06-15T18:30:00Z"), "Asia/Kolkata"), 0);
  });
  it("tells available, booked, assigned, occupied and repair apart", () => {
    const morning = { shiftStart: 360, shiftEnd: 840 }, evening = { shiftStart: 900, shiftEnd: 1260 };
    const at = 10 * 60;
    assert.equal(onShift({ ...morning, inside: false }, at), true);
    assert.equal(seatState("available", [], at), "available");
    assert.equal(seatState("available", [{ ...evening, inside: false }], at), "booked");
    assert.equal(seatState("available", [{ ...morning, inside: false }], at), "assigned");
    assert.equal(seatState("available", [{ ...morning, inside: true }, { ...evening, inside: false }], at), "occupied");
    assert.equal(seatState("maintenance", [{ ...morning, inside: true }], at), "maintenance");
  });
  it("treats a holder without shift times as on shift all day", () => {
    assert.equal(seatState(undefined, [{ inside: false }], 3 * 60), "assigned");
  });
});

describe("Plan entitlements", () => {
  it("keeps fee collection in the free plan's basic feature and expenses behind a paid plan", () => {
    const free = DEFAULT_PLANS.find((p) => p.key === "free")!, starter = DEFAULT_PLANS.find((p) => p.key === "starter")!;
    assert.ok(free.features.includes("basic"));
    assert.ok(!free.features.includes("fees-expenses") && starter.features.includes("fees-expenses"));
    assert.ok(!free.features.includes("crm") && !free.features.includes("qr-attendance"));
  });
});
