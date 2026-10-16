import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkEnv } from "../src/lib/env";
import { redact } from "../src/lib/log";
import { integrityReport, intervalsOverlap, validatePilotCsv } from "../src/lib/pilot";
import { clientIp } from "../src/lib/security";

const ref = {
  seats: new Map([["a1", "s1"], ["a2", "s2"]]),
  shifts: new Map([["morning", { id: "m", start: 360, end: 720 }], ["evening", { id: "e", start: 960, end: 1320 }]]),
  plans: new Map([["monthly", { id: "p", amount: 120000, days: 30 }]]),
};
const header = "name,email,phone,seat,shift,plan,start_date,paid_rupees,discount_rupees";

describe("Production config validation", () => {
  const good = { NODE_ENV: "production", MONGODB_URI: "mongodb://x", SESSION_SECRET: "k9Zq2vX7mP4tR8wB1nC6yL3hD5gJ0sAe", APP_URL: "https://app.example.com" } as unknown as NodeJS.ProcessEnv;
  it("accepts a valid production environment", () => assert.equal(checkEnv(good).filter((i) => i.level === "error").length, 0));
  it("rejects weak or placeholder secrets, http origins and enabled sandbox billing", () => {
    const errors = (env: object) => checkEnv({ ...good, ...env } as NodeJS.ProcessEnv).filter((i) => i.level === "error").map((i) => i.key);
    assert.ok(errors({ SESSION_SECRET: "short" }).includes("SESSION_SECRET"));
    assert.ok(errors({ SESSION_SECRET: "replace-with-a-random-secret-at-least-32-characters-long" }).includes("SESSION_SECRET"));
    assert.ok(errors({ APP_URL: "http://app.example.com" }).includes("APP_URL"));
    assert.ok(errors({ ALLOW_BILLING_SANDBOX: "1" }).includes("ALLOW_BILLING_SANDBOX"));
    assert.ok(errors({ MONGODB_URI: "" }).includes("MONGODB_URI"));
  });
});

describe("Log redaction", () => {
  it("removes secrets, tokens, emails and long numbers", () => {
    const out = redact({ password: "hunter2", token: "abc", nested: { authorization: "Bearer x", note: "mail a@b.co or 9876543210" }, jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig_value-1", safe: "ok" }) as Record<string, unknown>;
    const text = JSON.stringify(out);
    assert.ok(!text.includes("hunter2") && !text.includes("a@b.co") && !text.includes("9876543210") && !text.includes("eyJhbGci"));
    assert.equal(out.safe, "ok");
    assert.equal(out.password, "[redacted]");
  });
});

describe("Client IP trust", () => {
  const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
  it("ignores spoofable forwarded headers unless a proxy is trusted", () => {
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(req({ "x-forwarded-for": "1.2.3.4" })), "direct");
    process.env.TRUST_PROXY = "1";
    assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" })), "9.9.9.9"); // right-most hop is added by the trusted proxy
    delete process.env.TRUST_PROXY;
  });
});

describe("Paper-register import validation", () => {
  const run = (rows: string[], existing = [] as Parameters<typeof validatePilotCsv>[2]) => validatePilotCsv([header, ...rows].join("\n"), ref, existing);
  it("accepts a clean register and computes due balances in paise", () => {
    const r = run(["Asha Rao,asha@x.in,98765 43210,A1,Morning,Monthly,2026-10-01,1000,0", "Ravi K,ravi@x.in,,A2,Morning,Monthly,2026-10-01,0,200"]);
    assert.equal(r.issues.length, 0);
    assert.deepEqual([r.totals.students, r.totals.paidPaise, r.totals.duePaise, r.totals.discountPaise], [2, 100000, 20000 + 100000, 20000]);
  });
  it("rejects unknown mappings, bad dates and impossible amounts", () => {
    const r = run(["A B,a@x.in,,Z9,Morning,Monthly,2026-10-01,0,0", "C D,c@x.in,,A1,Night,Monthly,2026-10-01,0,0", "E F,e@x.in,,A1,Morning,Gold,2026-10-01,0,0", "G H,g@x.in,,A1,Morning,Monthly,01/10/2026,0,0", "I J,i@x.in,,A1,Morning,Monthly,2026-10-01,5000,0", "K L,k@x.in,,A1,Morning,Monthly,2026-10-01,0,5000"]);
    assert.equal(r.rows.length, 0);
    assert.equal(r.issues.length, 6);
  });
  it("detects duplicate identities and in-file seat clashes", () => {
    const r = run(["A B,a@x.in,9876543210,A1,Morning,Monthly,2026-10-01,0,0", "A B,A@x.in,,A2,Morning,Monthly,2026-10-01,0,0", "C D,c@x.in,98765-43210,A2,Evening,Monthly,2026-10-01,0,0", "E F,e@x.in,,A1,Morning,Monthly,2026-10-10,0,0", "G H,g@x.in,,A1,Evening,Monthly,2026-10-10,0,0"]);
    const msgs = r.issues.map((i) => i.error).join(" | ");
    assert.match(msgs, /Duplicate email/); assert.match(msgs, /possible duplicate student/); assert.match(msgs, /already assigned/);
    assert.ok(r.rows.some((x) => x.email === "g@x.in"), "adjacent shifts on the same seat are allowed");
  });
  it("detects clashes with existing assignments and rejects missing columns", () => {
    const existing = [{ seatId: "s1", start: new Date("2026-09-25"), end: new Date("2026-10-25"), shiftStart: 360, shiftEnd: 720 }];
    assert.match(run(["A B,a@x.in,,A1,Morning,Monthly,2026-10-01,0,0"], existing).issues[0].error, /already assigned/);
    assert.match(validatePilotCsv("name,email\nA,b", ref).issues[0].error, /Missing columns/);
  });
  it("treats touching shifts and periods as non-overlapping", () => {
    const a = { start: new Date("2026-10-01"), end: new Date("2026-10-31"), shiftStart: 360, shiftEnd: 720 };
    assert.equal(intervalsOverlap(a, { ...a, shiftStart: 720, shiftEnd: 960 }), false);
    assert.equal(intervalsOverlap(a, { ...a, start: new Date("2026-10-31"), end: new Date("2026-11-30") }), false);
    assert.equal(intervalsOverlap(a, { ...a, shiftStart: 700, shiftEnd: 900 }), true);
  });
});

describe("Data integrity report", () => {
  const base = { students: ["u1", "u2"], memberships: [{ id: "m1", userId: "u1", amount: 120000, discount: 0, paid: 50000, status: "active" }, { id: "m2", userId: "u2", amount: 120000, discount: 20000, paid: 100000, status: "active" }], payments: [{ membershipId: "m1", amount: 50000 }, { membershipId: "m2", amount: 100000 }], assignments: [{ seatId: "s1", start: new Date("2026-10-01"), end: new Date("2026-10-31"), shiftStart: 360, shiftEnd: 720 }] };
  it("passes consistent data and reports outstanding dues", () => {
    const r = integrityReport(base);
    assert.equal(r.ok, true); assert.equal(r.duePaise, 70000);
  });
  it("flags missing memberships, payment mismatches, overpayment and seat overlaps", () => {
    const r = integrityReport({ ...base, students: [...base.students, "u3"], payments: [{ membershipId: "m1", amount: 40000 }, { membershipId: "m2", amount: 100000 }], memberships: [base.memberships[0], { ...base.memberships[1], paid: 130000 }], assignments: [...base.assignments, { ...base.assignments[0] }] });
    assert.equal(r.ok, false);
    assert.equal(r.problems.length, 4);
  });
});
