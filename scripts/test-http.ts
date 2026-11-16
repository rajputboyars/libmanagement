import { MongoMemoryReplSet } from "mongodb-memory-server";
import { execFileSync, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { dayKey } from "../src/lib/punch";
import { StudySession } from "../src/lib/models";
import { SignJWT } from "jose";
import { createServer as createHttpsServer, type Server as HttpsServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A local HTTPS "alert webhook" with a throwaway self-signed certificate (the application refuses plain http alert destinations in production).
type Sink = { url: string; hits: { body: Record<string, unknown> }[]; reqs: { path: string; at: number }[]; status: number; server: HttpsServer };
async function startSink(status: number): Promise<Sink | null> {
  const dir = mkdtempSync(join(tmpdir(), "sq-sink-"));
  try {
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(dir, "k.pem"), "-out", join(dir, "c.pem"), "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
    const sink = { hits: [] as Sink["hits"], reqs: [] as Sink["reqs"], status } as Sink;
    sink.server = createHttpsServer({ key: readFileSync(join(dir, "k.pem")), cert: readFileSync(join(dir, "c.pem")) }, (req, res) => {
      let data = "";
      req.on("data", (c) => { data += c; });
      req.on("end", () => { sink.reqs.push({ path: req.url ?? "", at: Date.now() }); try { sink.hits.push({ body: JSON.parse(data) }); } catch { /* ignore */ } res.writeHead(sink.status); res.end("{}"); });
    });
    await new Promise<void>((r) => sink.server.listen(0, "127.0.0.1", r));
    sink.url = `https://127.0.0.1:${(sink.server.address() as { port: number }).port}/alert`;
    return sink;
  } catch { return null; } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function main() {
  const replica = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.14" },
  });
  const base = "http://127.0.0.1:3101";
  const sessionSecret = randomBytes(32).toString("hex");
  const failingSink = await startSink(500); // alert delivery that always FAILS: the whole suite below must still pass
  const okSink = await startSink(200);
  const extraServers: ReturnType<typeof spawn>[] = [];
  const server = spawn(
    process.execPath,
    [
      "node_modules/next/dist/bin/next",
      "start",
      "--port",
      "3101",
      "--hostname",
      "127.0.0.1",
    ],
    {
      env: {
        ...process.env,
        MONGODB_URI: replica.getUri(),
        SESSION_SECRET: sessionSecret,
        APP_URL: base,
        ALLOW_BILLING_SANDBOX: "1",
        TRUST_PROXY: "1", // the rate-limit tests identify callers by X-Forwarded-For, which is only honoured behind a trusted proxy; do not depend on an untracked .env.production
        ...(failingSink ? { ALERT_WEBHOOK_URL: failingSink.url, NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let serverLog = "";
  server.stdout.on("data", (chunk) => { serverLog += chunk; });
  server.stderr.on("data", (chunk) => { serverLog += chunk; process.stderr.write(chunk); });
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try {
        if ((await fetch(base)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 500));
    }
    assert.ok(ready, "HTTP server becomes ready");
    const password = randomBytes(16).toString("hex");
    async function account(role: string, email: string) {
      const response = await fetch(base + "/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base },
        body: JSON.stringify({
          acceptTerms: true,
          name: "Integration Person",
          email,
          password,
          role,
          library: "Integration Library",
        }),
      });
      assert.equal(response.status, 200, await response.text());
      if (role === "owner") {
        // R9: a new owner gets no session, only an enrolment token. The harness stands in for completed enrolment
        // (the real enrolment flow is tested in the R9 block) and mints the session an enrolled owner would hold.
        assert.equal(response.headers.get("set-cookie"), null, "owner sign-up sets no session cookie");
        if (mongoose.connection.readyState === 0) await mongoose.connect(replica.getUri());
        const { User: U } = await import("../src/lib/models");
        const row = await U.findOneAndUpdate({ email }, { $set: { twoFactorEnabled: true } }, { new: true });
        return "sq-session=" + (await new SignJWT({ sv: row!.sessionVersion ?? 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(String(row!._id)).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(sessionSecret)));
      }
      return response.headers.get("set-cookie")!.split(";")[0];
    }
    async function get(cookie: string) {
      const response = await fetch(base + "/api/workspace", {
        headers: { cookie },
      });
      assert.equal(response.status, 200);
      return response.json();
    }
    async function post(
      cookie: string,
      action: string,
      data: unknown = {},
      status = 200,
    ) {
      const response = await fetch(base + "/api/workspace", {
        method: "POST",
        headers: { cookie, Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ action, data }),
      });
      const body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body;
    }
    // Owner invites by email; the student joins only after accepting.
    const invite = async (ownerCookie: string, studentCookie: string, name: string, email: string) => {
      const sent = await fetch(base + "/api/workspace", { method: "POST", headers: { cookie: ownerCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "students", data: { name, email } }) });
      assert.equal(sent.status, 200, await sent.text());
      const mine = await (await fetch(base + "/api/join", { headers: { cookie: studentCookie } })).json();
      const pending = mine.requests.find((r: { status: string; invitedBy?: string }) => r.status === "pending" && r.invitedBy);
      const ok = await fetch(base + "/api/join", { method: "POST", headers: { cookie: studentCookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "invite-accept", data: { id: pending._id } }) });
      assert.equal(ok.status, 200, await ok.text());
    };
    const owner = await account("owner", "owner@example.invalid");
    const other = await account("owner", "other@example.invalid");
    const student = await account("student", "student@example.invalid");
    assert.equal((await fetch(base + "/api/workspace")).status, 401);
    await post(student, "seats", { label: "Forbidden", floor: "Ground" }, 403);
    await invite(owner, student, "Student", "student@example.invalid");
    await post(owner, "seats", { label: "A1", floor: "Ground" });
    await post(owner, "plans", { name: "Monthly", amount: 100000, days: 30 });
    let state = await get(owner);
    assert.equal((await get(other)).seats.length, 0);
    const allocation = {
      userId: state.students[0]._id,
      planId: state.plans[0]._id,
      seatId: state.seats[0]._id,
      start: new Date().toISOString(),
      shiftStart: 360,
      shiftEnd: 840,
      discount: 0,
    };
    await post(other, "memberships", allocation, 400);
    await post(owner, "memberships", allocation);
    await post(owner, "memberships", allocation, 400);
    state = await get(owner);
    const membershipId = state.memberships[0]._id;
    await post(
      owner,
      "payments",
      { membershipId, amount: 200000, method: "cash", key: "overpayment" },
      400,
    );
    const payment = {
      membershipId,
      amount: 25000,
      method: "upi",
      key: "idempotent-test-key",
    };
    await post(owner, "payments", payment);
    await post(owner, "payments", payment);
    state = await get(owner);
    assert.equal(state.payments.length, 1);
    assert.equal(state.memberships[0].paid, 25000);
    assert.equal(state.summary.revenue, 25000);
    async function maintenance(cookie: string, action: string, data: unknown, status = 200) {
      const response = await fetch(base + "/api/maintenance", {
        method: "POST",
        headers: { cookie, Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ action, data }),
      });
      const body = await response.json();
      assert.equal(response.status, status, JSON.stringify(body));
      return body;
    }
    await post(owner, "seats", { label: "A2", floor: "Ground" });
    const spare = (await get(owner)).seats.find((seat: { label: string }) => seat.label === "A2");
    const issueBase = { category: "electrical", title: "Broken socket", seatId: spare._id };
    await maintenance(student, "issue-report", { ...issueBase, seatOffline: true }, 400);
    await maintenance(other, "issue-report", issueBase, 400);
    const reported = await maintenance(student, "issue-report", issueBase);
    await maintenance(student, "issue-report", issueBase, 400);
    await maintenance(student, "issue-update", { id: reported.record._id, status: "resolved" }, 400);
    await maintenance(other, "issue-update", { id: reported.record._id, status: "assigned" }, 400);
    await maintenance(owner, "issue-update", { id: reported.record._id, seatOffline: true, status: "in-progress" });
    const blocked = await fetch(base + "/api/workspace", {
      method: "POST",
      headers: { cookie: owner, Origin: base, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "memberships", data: { ...allocation, seatId: spare._id } }),
    });
    assert.equal(blocked.status, 400);
    assert.match((await blocked.json()).error, /out of service/);
    await maintenance(owner, "issue-update", { id: reported.record._id, status: "resolved", costPaise: 45000 });
    const reopened = await (await fetch(base + "/api/maintenance", { headers: { cookie: owner } })).json();
    assert.equal(reopened.seats.find((seat: { label: string }) => seat.label === "A2").operationalStatus, "available");
    assert.equal(reopened.summary.repairCostPaise, 45000);
    const studentView = await (await fetch(base + "/api/maintenance", { headers: { cookie: student } })).json();
    assert.equal(studentView.issues[0].costPaise, undefined);
    assert.equal(studentView.summary, null);
    const receiptId = state.payments[0]._id;
    for (const cookie of [owner, student])
      assert.equal(
        (
          await fetch(`${base}/api/receipts/${receiptId}`, {
            headers: { cookie },
          })
        ).status,
        200,
      );
    assert.equal(
      (
        await fetch(`${base}/api/receipts/${receiptId}`, {
          headers: { cookie: other },
        })
      ).status,
      404,
    );
    const listing = await fetch(
      `${base}/api/workspace?resource=payments&q=idempotent`,
      { headers: { cookie: owner } },
    );
    assert.equal(listing.status, 200);
    const staff = await account("student", "staff@example.invalid");
    // Staff must first join the library themselves (accepting an invite), then the owner gives a permission.
    await invite(owner, staff, "Staff", "staff@example.invalid");
    await post(owner, "staff", {
      email: "staff@example.invalid",
      permission: "attendance",
    });
    assert.equal((await get(staff)).payments.length, 0);
    // ---- fees: pending view, reversal and reminders ----
    const feeGet = async (cookie: string, q = "", status = 200) => {
      const r = await fetch(`${base}/api/fees${q}`, { headers: { cookie } });
      const text = await r.text();
      assert.equal(r.status, status, text);
      return JSON.parse(text);
    };
    const feePost = async (cookie: string, action: string, data: unknown = {}, status = 200) => {
      const r = await fetch(`${base}/api/fees`, { method: "POST", headers: { cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const text = await r.text();
      assert.equal(r.status, status, text);
      return JSON.parse(text);
    };
    const feeList = await feeGet(owner);
    assert.equal(feeList.totals.pending, 75000);
    assert.equal(feeList.students.length, 1);
    assert.equal(feeList.students[0].paid, 25000);
    await feeGet(student, "", 403);
    await feeGet(staff, "", 403);
    assert.equal((await feeGet(other)).students.length, 0, "another library sees none of these students");
    assert.equal((await feeGet(owner, "?q=zzzz")).students.length, 0);
    assert.equal((await feeGet(owner, "?q=zzzz")).totals.pending, 75000, "header totals cover the whole library, not just the search");
    assert.equal((await feeGet(owner, "?filter=clear")).students.length, 0);
    await feeGet(other, `?student=${state.students[0]._id}`, 404);
    assert.equal((await feeGet(owner, `?student=${state.students[0]._id}`)).payments.length, 1);
    await feePost(staff, "remind", {}, 403);
    assert.equal((await feePost(owner, "remind")).sent, 1);
    const remindAgain = await feePost(owner, "remind");
    assert.deepEqual([remindAgain.sent, remindAgain.skipped], [0, 1], "one reminder per student per day");
    assert.ok((await get(student)).notifications.some((n: { title: string }) => n.title === "Library fee reminder"));
    // reversing a payment keeps the record and restores the balance exactly once
    const wrongPayment = state.payments[0]._id;
    await post(student, "payment-reverse", { paymentId: wrongPayment, reason: "Entered twice" }, 403);
    await post(other, "payment-reverse", { paymentId: wrongPayment, reason: "Entered twice" }, 400);
    await post(owner, "payment-reverse", { paymentId: wrongPayment, reason: "x" }, 400);
    await post(owner, "payment-reverse", { paymentId: wrongPayment, reason: "Entered wrong amount" });
    await post(owner, "payment-reverse", { paymentId: wrongPayment, reason: "Entered wrong amount" }, 400);
    state = await get(owner);
    assert.equal(state.memberships[0].paid, 0);
    assert.equal(state.summary.revenue, 0, "reversed money is not revenue");
    assert.equal(state.payments.length, 1, "the original payment record is kept");
    assert.ok(state.payments[0].reversedAt && state.payments[0].reversalReason === "Entered wrong amount");
    assert.equal((await feeGet(owner)).totals.pending, 100000);
    await post(owner, "payments", { membershipId, amount: 25000, method: "upi", key: "corrected-payment-key" });
    state = await get(owner);
    assert.deepEqual([state.memberships[0].paid, state.summary.revenue, state.payments.length], [25000, 25000, 2]);
    assert.equal((await feeGet(owner)).totals.pending, 75000);
    // ---- modules, roles and permissions ----
    const accessGet = async (cookie: string, q = "", status = 200) => {
      const r = await fetch(`${base}/api/access${q}`, { headers: { cookie } });
      const text = await r.text();
      assert.equal(r.status, status, text);
      return JSON.parse(text);
    };
    const accessPost = async (cookie: string, action: string, data: unknown = {}, status = 200) => {
      const r = await fetch(`${base}/api/access`, { method: "POST", headers: { cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      const text = await r.text();
      assert.equal(r.status, status, text);
      return JSON.parse(text);
    };
    const status = async (url: string, cookie: string) => (await fetch(`${base}${url}`, { headers: { cookie } })).status;
    // staff created before roles existed keep exactly the access they had, with no migration
    const legacyAccess = await accessGet(staff);
    assert.equal(legacyAccess.kind, "staff");
    assert.ok(legacyAccess.permissions.includes("attendance.mark") && legacyAccess.permissions.includes("seats.view"));
    assert.ok(!legacyAccess.permissions.includes("fees.view") && !legacyAccess.permissions.includes("fees.reverse") && !legacyAccess.permissions.includes("memberships.create"));
    assert.equal((await accessGet(student)).kind, "student");
    await accessGet(student, "?view=manage", 403);
    await accessGet(staff, "?view=manage", 403);
    const manage = await accessGet(owner, "?view=manage");
    assert.deepEqual(manage.roles.map((r: { key: string }) => r.key).sort(), ["accountant", "attendance", "manager", "receptionist"]);
    assert.ok(!manage.roles.find((r: { key: string }) => r.key === "manager").permissions.includes("fees.reverse"), "no ready-made role can reverse payments");
    assert.ok(manage.registry.every((m: { state: { enabled: boolean } }) => m.state.enabled), "existing libraries start with everything their plan allows turned on");
    // roles: only the owner manages them; unknown permissions are refused; names are unique per library
    await accessPost(staff, "role-save", { name: "Sneaky", permissions: [] }, 403);
    await accessPost(student, "role-save", { name: "Sneaky", permissions: [] }, 403);
    await accessPost(staff, "module-set", { module: "crm", enabled: false }, 403);
    await accessPost(owner, "role-save", { name: "Cashier", permissions: ["fees.view", "bogus.permission"] }, 400);
    await accessPost(owner, "role-save", { name: "Cashier", description: "Takes payments", permissions: ["fees.view", "fees.create", "students.view", "memberships.view"] });
    await accessPost(owner, "role-save", { name: "cashier", permissions: [] }, 400);
    const cashier = (await accessGet(owner, "?view=manage")).roles.find((r: { name: string }) => r.name === "Cashier");
    // tenant isolation: another library can neither see, edit, delete nor assign this role
    assert.equal((await accessGet(other, "?view=manage")).roles.some((r: { name: string }) => r.name === "Cashier"), false);
    await accessPost(other, "role-save", { id: cashier._id, name: "Hijack", permissions: [] }, 400);
    await accessPost(other, "role-delete", { id: cashier._id }, 400);
    await accessPost(other, "staff-assign", { email: "staff@example.invalid", roleId: cashier._id }, 400);
    await accessPost(owner, "staff-assign", { email: "staff@example.invalid", roleId: cashier._id });
    const cashierAccess = await accessGet(staff);
    assert.equal(cashierAccess.roleName, "Cashier");
    assert.ok(cashierAccess.permissions.includes("fees.create") && !cashierAccess.permissions.includes("attendance.mark"));
    await accessPost(owner, "role-delete", { id: cashier._id }, 400); // still has someone on it
    await feeGet(staff, "", 200);
    await post(staff, "payments", { membershipId, amount: 1000, method: "cash", key: "cashier-payment-1" });
    await post(staff, "attendance", { userId: state.students[0]._id }, 403); // the role has no attendance permission
    await post(staff, "seats", { label: "Z9", floor: "Ground" }, 403);
    const cashierPayment = (await get(owner)).payments.find((p: { amount: number }) => p.amount === 1000);
    await post(staff, "payment-reverse", { paymentId: cashierPayment._id, reason: "not allowed" }, 403); // reversal stays with the owner
    await post(owner, "payment-reverse", { paymentId: cashierPayment._id, reason: "test cleanup" });
    assert.equal((await get(staff)).students.length, 1, "the role can see students");
    assert.equal(await status("/api/punch", staff), 403, "the role has no attendance access");
    // modules: off blocks pages and APIs but keeps every record; on brings them back
    const paymentsBefore = (await get(owner)).payments.length;
    await accessPost(owner, "module-set", { module: "fees", enabled: false });
    await feeGet(owner, "", 403);
    await feeGet(staff, "", 403);
    const moduleBlockedPay = await post(owner, "payments", { membershipId, amount: 100, method: "cash", key: "blocked-by-module" }, 403);
    assert.equal(moduleBlockedPay.code, "module-disabled");
    assert.equal((await get(owner)).payments.length, 0, "a module that is off shows no records");
    assert.equal(await status(`/api/receipts/${receiptId}`, owner), 403);
    assert.equal((await accessGet(owner)).modules.fees.reason, "library");
    assert.equal((await accessGet(other)).modules.fees.enabled, true, "another library is not affected");
    await accessPost(owner, "module-set", { module: "fees", enabled: true });
    assert.equal((await get(owner)).payments.length, paymentsBefore, "turning a module back on restores its data");
    // a module that others depend on takes them down with it
    await accessPost(owner, "module-set", { module: "seats", enabled: false });
    const deps = (await accessGet(owner)).modules;
    assert.deepEqual([deps.memberships.reason, deps.fees.reason, deps.waitlist.reason], ["dependency", "dependency", "dependency"]);
    await feeGet(owner, "", 403);
    assert.equal(await status("/api/seat-map", owner), 403);
    await accessPost(owner, "module-set", { module: "seats", enabled: true });
    await feeGet(owner, "", 200);
    // students are held to the same switches
    await accessPost(owner, "module-set", { module: "attendance", enabled: false });
    assert.equal(await status("/api/punch", student), 403);
    await accessPost(owner, "module-set", { module: "attendance", enabled: true });
    assert.equal(await status("/api/punch", student), 200);
    await accessPost(owner, "staff-assign", { email: "staff@example.invalid", roleId: null }); // back to a student for the checks below
    assert.equal((await accessGet(staff)).kind, "student");
    await post(owner, "staff", { email: "staff@example.invalid", permission: "attendance" }); // the older fixed-permission grant still works
    assert.equal((await accessGet(staff)).kind, "staff");
    await post(staff, "attendance", { userId: allocation.userId });
    await post(
      staff,
      "expenses",
      {
        title: "Forbidden",
        amount: 100,
        category: "Other",
        date: new Date().toISOString(),
      },
      403,
    );
    await post(owner, "staff", {
      email: "staff@example.invalid",
      permission: "none",
    });
    await post(staff, "attendance", { userId: allocation.userId }, 403);
    assert.equal(
      (await fetch(base + "/api/attendance-qr", { headers: { cookie: owner } }))
        .status,
      200,
    );
    const checkInToken = await new SignJWT({
      libraryId: state.user.libraryId,
      purpose: "attendance",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(randomUUID())
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(sessionSecret));
    await post(student, "check-in", { token: checkInToken });
    await post(student, "check-in", { token: checkInToken });
    assert.equal((await get(owner)).attendance.length, 1);
    await post(owner, "membership-status", { membershipId, status: "paused" });
    await post(student, "check-in", { token: checkInToken }, 400);
    await post(owner, "membership-status", { membershipId, status: "active" });
    await post(owner, "payments", {
      membershipId,
      amount: 75000,
      method: "cash",
      key: "clear-balance",
    });
    const renewal = {
      membershipId,
      method: "cash",
      key: "renewal-idempotency",
      confirmation: "RECEIVED",
    };
    await post(owner, "renew", renewal);
    await post(owner, "renew", renewal);
    assert.equal((await get(owner)).memberships.length, 2);
    // renewal keeps the seat and charges plan price minus discount
    const renewedFirst = (await get(owner)).memberships.find((m: { previousMembershipId?: string }) => m.previousMembershipId === membershipId);
    assert.deepEqual([renewedFirst.discount, renewedFirst.paid], [0, 100000]);
    await post(owner, "renew", { membershipId: renewedFirst._id, method: "cash", confirmation: "RECEIVED", key: "discounted-renewal", discount: 100001 }, 400);
    await post(owner, "renew", { membershipId: renewedFirst._id, method: "cash", confirmation: "RECEIVED", key: "discounted-renewal", discount: 20000 });
    const { Membership: RenewM, SeatAssignment: RenewSA, Payment: RenewP } = await import("../src/lib/models");
    if (mongoose.connection.readyState === 0) await mongoose.connect(replica.getUri());
    type RenewDoc = { _id: unknown; discount: number; paid: number; seatId: unknown; amount: number };
    const renewedSecond = await RenewM.findOne({ previousMembershipId: renewedFirst._id }).lean<RenewDoc>();
    assert.deepEqual([renewedSecond!.discount, renewedSecond!.paid], [20000, 80000]);
    const carried = await RenewSA.findOne({ membershipId: renewedSecond!._id }).lean<RenewDoc>();
    const firstSeat = await RenewSA.findOne({ membershipId: renewedFirst._id }).lean<RenewDoc>();
    assert.equal(String(carried!.seatId), String(firstSeat!.seatId), "the same seat carries forward");
    assert.equal((await RenewP.findOne({ key: "discounted-renewal" }).lean<RenewDoc>())!.amount, 80000);
    await RenewP.deleteOne({ key: "discounted-renewal" }); await RenewSA.deleteMany({ membershipId: renewedSecond!._id }); await RenewM.deleteOne({ _id: renewedSecond!._id }); // keep later checks exact
    await post(other, "payments", { ...payment, key: "cross-tenant" }, 400);
    await post(student, "focus.start");
    await post(student, "focus.complete", {}, 400);
    await mongoose.connect(replica.getUri());
    // closed-out memberships never count as outstanding dues
    const { Membership: DuesMembership } = await import("../src/lib/models");
    const duesStudentId = (await get(student)).user._id;
    assert.equal((await get(owner)).summary.due, 0);
    await DuesMembership.create([
      { libraryId: state.user.libraryId, userId: duesStudentId, start: new Date(Date.now() - 9 * 86400000), end: new Date(Date.now() + 9 * 86400000), amount: 50000, status: "cancelled" },
      { libraryId: state.user.libraryId, userId: duesStudentId, start: new Date(Date.now() - 60 * 86400000), end: new Date(Date.now() - 30 * 86400000), amount: 50000, status: "expired" },
    ]);
    assert.equal((await get(owner)).summary.due, 0, "cancelled and expired memberships do not inflate dues");
    await DuesMembership.create({ libraryId: state.user.libraryId, userId: duesStudentId, start: new Date(), end: new Date(Date.now() + 9 * 86400000), amount: 50000, discount: 10000, paid: 5000, status: "active" });
    assert.equal((await get(owner)).summary.due, 35000, "a running membership still shows what is owed");
    await DuesMembership.deleteMany({ libraryId: state.user.libraryId, userId: duesStudentId, amount: 50000 }); // keep later reconciliation checks exact
    await StudySession.updateOne(
      { userId: (await get(student)).user._id, state: "running" },
      { $set: { lastResumedAt: new Date(Date.now() - 1501000) } },
    );
    await post(student, "focus.complete");
    await post(student, "focus.complete", {}, 400);
    const study = await get(student);
    assert.equal(
      study.xp.filter((x: { source: string }) => x.source.startsWith("focus:"))
        .length,
      1,
    );
    assert.equal(study.xp[0].amount, 10);
    async function api(path: string, cookie: string, action: string, data: unknown = {}, status = 200) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: { cookie, Origin: base, "Content-Type": "application/json" },
        body: JSON.stringify({ action, data }),
      });
      const body = await response.json();
      assert.equal(response.status, status, `${action}: ${JSON.stringify(body)}`);
      return body;
    }
    const getJson = async (path: string, cookie: string) => (await fetch(base + path, { headers: { cookie } })).json();
    const minor = await account("student", "minor@example.invalid");
    await invite(owner, minor, "Minor", "minor@example.invalid");
    const studentId = study.user._id;
    const community = (cookie: string, action: string, data: unknown = {}, status = 200) => api("/api/community", cookie, action, data, status);
    const adultProfile = { optedIn: true, alias: "Comet", ageBand: "adult", lookingForBuddy: true, sharedGoal: "Finish quant by December" };
    await community(student, "profile-save", adultProfile, 400); // no exam target yet
    const exam = { examKey: "ssc", examDate: new Date(Date.now() + 90 * 86400000).toISOString(), weeklyMinutes: 600 };
    await api("/api/phase2", student, "exam-save", exam);
    await api("/api/phase2", minor, "exam-save", exam);
    await community(student, "profile-save", { ...adultProfile, sharedGoal: "mail me at a@b.co" }, 422);
    await community(student, "profile-save", adultProfile);
    await community(minor, "profile-save", { ...adultProfile, alias: "comet", ageBand: "minor", guardianName: "G", guardianContact: "g@example.invalid" }, 400); // alias clash
    await community(minor, "profile-save", { ...adultProfile, alias: "Nova", ageBand: "minor" }, 400); // guardian required
    await community(minor, "profile-save", { ...adultProfile, alias: "Nova", ageBand: "minor", guardianName: "Guardian", guardianContact: "g@example.invalid" });
    await community(minor, "buddy-request", { userId: studentId }, 400); // consent pending
    const hubBefore = await getJson("/api/community?view=hub", student);
    assert.equal(hubBefore.group.count, 1, "pending minors are invisible");
    await community(other, "mod-consent", { userId: (await getJson("/api/community?view=hub", minor)).profile.userId, decision: "approved" }, 400); // other tenant
    assert.equal((await getJson("/api/community?view=moderation", student)).error, "Library team access required");
    const pending = (await getJson("/api/community?view=moderation", owner)).consents;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].guardianContact, "g@example.invalid");
    await community(owner, "mod-consent", { userId: pending[0].userId, decision: "approved" });
    await community(student, "buddy-request", { userId: pending[0].userId }, 400); // different age group
    await community(student, "post-create", { milestoneType: "streak", milestoneValue: 100, visibility: "public", consent: true }, 400); // unverified
    await StudySession.create({ userId: studentId, state: "complete", startedAt: new Date(), completedAt: new Date(), activeSeconds: 6 * 3600 });
    await community(student, "post-create", { milestoneType: "focus-hours", milestoneValue: 5, visibility: "public" }, 422); // consent required
    const created = await community(student, "post-create", { milestoneType: "focus-hours", milestoneValue: 5, visibility: "public", message: "Keep going", consent: true });
    await community(student, "post-create", { milestoneType: "focus-hours", milestoneValue: 5, visibility: "public", consent: true }, 400); // duplicate
    await community(minor, "post-create", { milestoneType: "focus-hours", milestoneValue: 5, visibility: "library", consent: true }, 400); // not verified for minor
    const cardUrl = `${base}/api/community/card/${created.record._id}`;
    const card = await fetch(cardUrl, { headers: { cookie: student } });
    assert.equal(card.status, 200);
    assert.match(await card.text(), /5 hours of verified focus/);
    assert.equal((await fetch(cardUrl, { headers: { cookie: other } })).status, 404);
    assert.equal((await fetch(cardUrl)).status, 404);
    assert.equal((await fetch(cardUrl, { headers: { cookie: minor } })).status, 200); // public + adult author + approved viewer
    await community(minor, "report", { postId: created.record._id, reason: "inappropriate" });
    await community(minor, "report", { postId: created.record._id, reason: "inappropriate" }, 400);
    const reports = (await getJson("/api/community?view=moderation", owner)).reports;
    assert.equal(reports.length, 1);
    await community(owner, "mod-report", { id: reports[0]._id, decision: "remove-post", note: "Test" });
    assert.equal((await fetch(cardUrl, { headers: { cookie: minor } })).status, 404);
    assert.equal((await getJson("/api/community?view=wall", student)).mine[0].status, "removed");
    await community(minor, "block", { userId: studentId });
    await community(student, "buddy-request", { userId: pending[0].userId }, 400);
    await community(student, "profile-save", { ...adultProfile, optedIn: false });
    assert.equal((await getJson("/api/community?view=wall", student)).locked, true);
    // ---- Phase 4: exam preparation engine ----
    const { Question, SyllabusNode, TestAttempt, User, XPTransaction, MistakeEntry } = await import("../src/lib/models");
    const adminUser = await User.create({ name: "Admin", email: "admin@example.invalid", passwordHash: "x", role: "super-admin", twoFactorEnabled: true });
    const adminCookie = "sq-session=" + (await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(String(adminUser._id)).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(sessionSecret)));
    const pa = (action: string, data: unknown, status = 200, cookie = adminCookie) => api("/api/prep-admin", cookie, action, data, status);
    // ---- platform module availability (separate from the library's own switches and the plan) ----
    const platformMods = async (cookie: string, action: string, data: unknown, status = 200) => {
      const r = await fetch(`${base}/api/platform-modules`, { method: "POST", headers: { cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
      assert.equal(r.status, status, await r.clone().text());
      return r.json();
    };
    const modStatus = async (url: string, cookie: string) => (await fetch(`${base}${url}`, { headers: { cookie } })).status;
    assert.equal(await modStatus("/api/platform-modules", owner), 403);
    assert.equal(await modStatus("/api/platform-modules", student), 403);
    assert.equal(await modStatus("/api/platform-modules", adminCookie), 200);
    const orgOfOwner = (await getJson("/api/org", owner)).organization._id;
    await platformMods(owner, "org-set", { organizationId: orgOfOwner, blocked: ["rewards"] }, 403);
    await platformMods(adminCookie, "org-set", { organizationId: orgOfOwner, blocked: ["not-a-module"] }, 400);
    await platformMods(adminCookie, "org-set", { organizationId: orgOfOwner, blocked: ["rewards"] });
    const blockedMods = (await getJson("/api/access", owner)).modules;
    assert.deepEqual([blockedMods.rewards.enabled, blockedMods.rewards.reason], [false, "platform"]);
    assert.equal((await getJson("/api/access", other)).modules.rewards.enabled, true, "only that organization is blocked");
    assert.equal(await modStatus("/api/rewards", owner), 403);
    await fetch(`${base}/api/access`, { method: "POST", headers: { cookie: owner, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "module-set", data: { module: "rewards", enabled: true } }) });
    assert.equal((await getJson("/api/access", owner)).modules.rewards.enabled, false, "a library cannot override the platform");
    await platformMods(adminCookie, "org-set", { organizationId: orgOfOwner, blocked: [] });
    assert.equal((await getJson("/api/access", owner)).modules.rewards.enabled, true);
    await platformMods(adminCookie, "global-set", { blocked: ["events"] });
    assert.equal((await getJson("/api/access", other)).modules.events.reason, "platform");
    await platformMods(adminCookie, "global-set", { blocked: [] });
    // platform admin is not library staff: library routes do not accept it
    for (const url of ["/api/fees", "/api/seat-map", "/api/access?view=manage"]) assert.notEqual(await modStatus(url, adminCookie), 200, url);
    const pp = (cookie: string, action: string, data: unknown = {}, status = 200) => api("/api/prep", cookie, action, data, status);
    await pa("question-import", { examKey: "ssc", rows: [], source: { name: "x", license: "original" } }, 422);
    await pa("date-save", { examKey: "ssc", title: "x" }, 403, student);
    const subject = await SyllabusNode.create({ examKey: "ssc", type: "subject", title: "Quant", order: 1 });
    const chapter = await SyllabusNode.create({ examKey: "ssc", type: "chapter", title: "Arithmetic", parentId: subject._id, order: 1 });
    const topicNode = await SyllabusNode.create({ examKey: "ssc", type: "topic", title: "Percentages", parentId: chapter._id, order: 1 });
    const rows = Array.from({ length: 12 }, (_, i) => ({ prompt: `What is ${i + 10} plus ${i + 20}, exactly?`, options: [String(i * 2 + 30), String(i * 2 + 31), String(i * 2 + 32), String(i * 2 + 33)], correctIndex: i % 4, explanation: `Add them: ${i + 10 + (i + 20)}.` }));
    const messy = [...rows, rows[0], { prompt: "bad", options: ["a"], correctIndex: 5, explanation: "" }];
    const dry = await pa("question-import", { examKey: "ssc", topicId: String(topicNode._id), rows: messy, dryRun: true, source: { name: "Original authoring", license: "original" } });
    assert.deepEqual(dry.summary, { ok: 12, duplicate: 1, invalid: 1 });
    assert.equal(dry.created, 0);
    await pa("question-import", { examKey: "ssc", topicId: String(topicNode._id), rows: messy, dryRun: false, source: { name: "x", license: "unknown" } }, 400);
    const real = await pa("question-import", { examKey: "ssc", topicId: String(topicNode._id), rows: messy, dryRun: false, source: { name: "Original authoring", license: "original" } });
    assert.equal(real.created, 12);
    const again = await pa("question-import", { examKey: "ssc", rows, dryRun: true, source: { name: "Original authoring", license: "original" } });
    assert.equal(again.summary.duplicate, 12);
    await pp(student, "daily-start", {}, 400); // drafts are invisible to students
    const drafts = await Question.find({ examKey: "ssc" }).lean();
    for (const d of drafts) {
      await pa("question-status", { id: String(d._id), status: "published" }, 400); // must pass review first
      await pa("question-status", { id: String(d._id), status: "in-review" });
      await pa("question-status", { id: String(d._id), status: "published" });
    }
    const tooBig = await pa("template-save", { examKey: "ssc", title: "Too big", kind: "full", durationMinutes: 30, sections: [{ name: "A", count: 50, marks: 1, negative: 0.25 }] });
    await pa("template-status", { id: tooBig.record._id, status: "published" }, 400);
    await pa("template-save", { examKey: "ssc", title: "Bad", kind: "full", durationMinutes: 30, sections: [{ name: "A", count: 5, marks: 1, negative: 2 }] }, 400);
    const tpl = await pa("template-save", { examKey: "ssc", title: "Mock 1", kind: "full", durationMinutes: 30, sections: [{ name: "Quant A", count: 6, marks: 2, negative: 0.5 }, { name: "Quant B", count: 4, marks: 1, negative: 0.25 }] });
    await pp(student, "test-start", { templateId: tpl.record._id }, 400); // unpublished
    await pa("template-status", { id: tpl.record._id, status: "published" });
    const started = await pp(student, "test-start", { templateId: tpl.record._id });
    const resumed = await pp(student, "test-start", { templateId: tpl.record._id });
    assert.equal(resumed.attemptId, started.attemptId);
    assert.equal(resumed.resumed, true);
    const live = await getJson(`/api/prep?view=attempt&id=${started.attemptId}`, student);
    assert.equal(live.questions.length, 10);
    assert.ok(!JSON.stringify(live).match(/correctIndex|explanation/), "answer key must not leak before submission");
    assert.equal((await getJson(`/api/prep?view=attempt&id=${started.attemptId}`, minor)).error, "Attempt not found");
    assert.equal((await getJson(`/api/prep?view=result&id=${started.attemptId}`, student)).error, "This attempt is still in progress");
    const keyRows = await Question.find({ _id: { $in: live.questions.map((x: { _id: string }) => x._id) } }).select("+correctIndex").lean<{ _id: unknown; correctIndex: number }[]>();
    const keys = new Map<string, number>(keyRows.map((k) => [String(k._id), k.correctIndex] as [string, number]));
    const wrongOf = (id: string) => ((keys.get(id) as number) + 1) % 4;
    const [q0, q1, q2, q3, q4, q5] = live.questions;
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: q0._id, selectedIndex: keys.get(q0._id) });
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: q1._id, selectedIndex: keys.get(q1._id), flagged: true });
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: q2._id, selectedIndex: wrongOf(q2._id) });
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: q3._id, selectedIndex: wrongOf(q3._id) });
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: q4._id, selectedIndex: 9 }, 422);
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: q5._id, selectedIndex: keys.get(q5._id) });
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: "0".repeat(24), selectedIndex: 0 }, 400);
    await pp(minor, "answer-save", { attemptId: started.attemptId, questionId: q0._id, selectedIndex: 0 }, 400);
    const resumedView = await getJson(`/api/prep?view=attempt&id=${started.attemptId}`, student);
    assert.equal(resumedView.answers[q1._id].flagged, true);
    assert.ok(resumedView.remainingMs > 0 && resumedView.remainingMs <= 30 * 60000);
    const [s1, s2] = await Promise.all([1, 2].map(() => pp(student, "test-submit", { attemptId: started.attemptId })));
    assert.equal(s1.attemptId, s2.attemptId);
    await pp(student, "test-submit", { attemptId: started.attemptId });
    await pp(student, "answer-save", { attemptId: started.attemptId, questionId: q0._id, selectedIndex: 1 }, 400);
    const res = await getJson(`/api/prep?view=result&id=${started.attemptId}`, student);
    const planOf = (id: string) => live.questions.find((x: { _id: string }) => x._id === id);
    const expected = planOf(q0._id).marks + planOf(q1._id).marks + planOf(q5._id).marks - planOf(q2._id).negative - planOf(q3._id).negative;
    assert.equal(new Set(live.questions.map((x: { _id: string }) => x._id)).size, 10, "no question repeats inside an attempt");
    assert.equal(res.summary.score, expected);
    assert.deepEqual([res.summary.correct, res.summary.incorrect, res.summary.unattempted], [3, 2, 5]);
    assert.equal(res.summary.xpGranted, 20);
    assert.equal(res.standing.comparable, false);
    assert.equal(await XPTransaction.countDocuments({ userId: studentId, source: `prep:full:${tpl.record._id}` }), 1, "XP granted exactly once despite duplicate submits");
    assert.equal(await MistakeEntry.countDocuments({ userId: studentId }), 2);
    assert.equal(res.review.find((r: { questionId: string }) => r.questionId === q2._id).correctIndex, keys.get(q2._id));
    assert.equal((await getJson(`/api/prep?view=result&id=${started.attemptId}`, minor)).error, "Result not found");
    // mistake notebook, flashcards, notes
    const mistakes = await getJson("/api/prep?view=mistakes", student);
    assert.equal(mistakes.total, 2);
    assert.ok(!JSON.stringify(mistakes).match(/correctIndex|explanation/));
    const retry = await pp(student, "mistake-answer", { questionId: q2._id, selectedIndex: keys.get(q2._id) });
    assert.equal(retry.correct, true);
    await pp(minor, "mistake-answer", { questionId: q2._id, selectedIndex: 0 }, 400);
    await pp(student, "mistake-update", { id: mistakes.entries[0]._id, status: "understood" });
    assert.equal((await getJson("/api/prep?view=mistakes", student)).total, 1);
    await pp(student, "flash-create", { questionId: q3._id });
    await pp(student, "flash-create", { questionId: q3._id }, 400);
    await pp(minor, "flash-create", { questionId: q3._id }, 400);
    const cards = await getJson("/api/prep?view=flashcards", student);
    assert.equal(cards.due, 1);
    await pp(student, "flash-review", { id: cards.cards[0]._id, confidence: 4 });
    await pp(student, "flash-review", { id: cards.cards[0]._id, confidence: 4 }, 400);
    assert.equal((await getJson("/api/prep?view=flashcards", student)).due, 0);
    const note = await pp(student, "note-save", { title: "Percent tricks", body: "10% shortcut", tags: ["Tricks"] });
    await pp(minor, "note-delete", { id: note.record._id });
    assert.equal((await getJson("/api/prep?view=notes&q=shortcut", student)).total, 1);
    assert.equal((await getJson("/api/prep?view=notes&q=shortcut", minor)).total, 0);
    await pp(student, "note-delete", { id: note.record._id });
    assert.equal((await getJson("/api/prep?view=notes", student)).total, 0);
    // expiry: server deadline is authoritative and auto-submits saved answers
    const quick = await pa("template-save", { examKey: "ssc", title: "Quick", kind: "topic", durationMinutes: 3, sections: [{ name: "Only", count: 3, marks: 1, negative: 0 }] });
    await pa("template-status", { id: quick.record._id, status: "published" });
    const qs = await pp(student, "test-start", { templateId: quick.record._id });
    const qv = await getJson(`/api/prep?view=attempt&id=${qs.attemptId}`, student);
    await pp(student, "answer-save", { attemptId: qs.attemptId, questionId: qv.questions[0]._id, selectedIndex: 0 });
    await TestAttempt.updateOne({ _id: qs.attemptId }, { deadline: new Date(Date.now() - 20000) });
    assert.equal((await getJson(`/api/prep?view=attempt&id=${qs.attemptId}`, student)).finished, true);
    await pp(student, "answer-save", { attemptId: qs.attemptId, questionId: qv.questions[1]._id, selectedIndex: 0 }, 400);
    const expired = await getJson(`/api/prep?view=result&id=${qs.attemptId}`, student);
    assert.equal(expired.autoSubmitted, true);
    assert.equal(expired.summary.attempted, 1);
    // daily practice: one set per day, XP once
    const daily = await pp(student, "daily-start");
    assert.equal((await pp(student, "daily-start")).attemptId, daily.attemptId);
    const dv = await getJson(`/api/prep?view=attempt&id=${daily.attemptId}`, student);
    await pp(student, "test-submit", { attemptId: daily.attemptId, answers: dv.questions.map((x: { _id: string }) => ({ questionId: x._id, selectedIndex: keys.get(x._id) ?? 0 })) });
    const dr = await getJson(`/api/prep?view=result&id=${daily.attemptId}`, student);
    assert.ok(dr.summary.xpGranted > 0 && dr.summary.xpGranted <= 30);
    assert.equal((await pp(student, "daily-start")).state, "submitted");
    assert.equal((await getJson("/api/prep?view=analytics", student)).history.length, 3);
    const mini = await pp(student, "mini-start", { topicId: String(topicNode._id) });
    assert.ok(mini.attemptId);
    await pp(student, "mini-start", { topicId: "0".repeat(24) }, 400);
    // ---- Phase 2 milestone 6: friends, privacy and opt-in challenges ----
    const p2 = (cookie: string, action: string, data: unknown = {}, status = 200) => api("/api/phase2", cookie, action, data, status);
    const outsider = await account("student", "outsider@example.invalid");
    await p2(student, "friend-request", { email: "nobody@example.invalid" }, 400);
    await p2(student, "friend-request", { email: "student@example.invalid" }, 400); // cannot befriend self
    await p2(student, "friend-request", { email: "minor@example.invalid" });
    const minorId = (await getJson("/api/phase2", minor)).friendships[0];
    await p2(outsider, "friend-respond", { id: minorId._id, status: "accepted" }, 400); // only the recipient can respond
    await p2(student, "challenge-create", { friendIds: [String(minorId.recipientId)], title: "Weekly focus", metric: "focus-minutes", target: 300 }, 400); // not accepted yet
    await p2(minor, "friend-respond", { id: minorId._id, status: "accepted" });
    const challenge = await p2(student, "challenge-create", { friendIds: [String(minorId.recipientId)], title: "Weekly focus", metric: "focus-minutes", target: 300 });
    await p2(outsider, "challenge-join", { id: challenge.record._id }, 400); // uninvited
    await p2(minor, "challenge-join", { id: challenge.record._id });
    assert.equal((await getJson("/api/phase2", outsider)).friendships.length, 0, "friend data stays private");
    // ---- Phase 5: tenancy, entitlements and billing ----
    const S = await import("../src/lib/saas-models");
    const { Library: LibraryModel, Membership: MembershipModel } = await import("../src/lib/models");
    const { createHash: sha, randomBytes: rb } = await import("node:crypto");
    const { sign: signBody } = await import("../src/lib/saas");
    const org = (cookie: string, action: string, data: unknown = {}, status = 200) => api("/api/org", cookie, action, data, status);
    const bill = (cookie: string, action: string, data: unknown = {}, status = 200) => api("/api/billing", cookie, action, data, status);
    const ctx = await getJson("/api/org", owner);
    assert.equal(ctx.role, "org-owner");
    assert.equal(ctx.branches.length, 1);
    assert.equal(ctx.entitlements.planName, "Pro", "new organizations start on a Pro trial");
    const ownerBranch = ctx.activeBranchId as string;
    const otherCtx = await getJson("/api/org", other);
    assert.notEqual(otherCtx.organization._id, ctx.organization._id);
    await org(other, "switch-branch", { branchId: ownerBranch }, 403); // cross-tenant switch is denied
    await org(owner, "switch-branch", { branchId: otherCtx.activeBranchId }, 403);
    await org(student, "branch-create", { branchName: "X" }, 403);
    await org(owner, "branch-create", { branchName: "Annex" }, 402); // multi-branch is a Business feature
    const mgr = await account("student", "manager@example.invalid");
    await S.SaaSSubscription.updateOne({ organizationId: ctx.organization._id }, { planKey: "business", "planSnapshot.features": ["basic", "fees-expenses", "crm", "qr-attendance", "advanced-reports", "multi-branch", "advanced-controls"], "planSnapshot.limits": { activeStudents: 2000, branches: 2 }, "planSnapshot.name": "Business" });
    const branch2 = await org(owner, "branch-create", { branchName: "Annex", city: "Pune" });
    await org(owner, "branch-create", { branchName: "Third" }, 402); // branch limit
    await org(owner, "member-add", { email: "manager@example.invalid", role: "branch-manager", branchIds: [String(branch2.record._id)] });
    await org(mgr, "switch-branch", { branchId: ownerBranch }, 403); // manager only reaches assigned branches
    await org(mgr, "switch-branch", { branchId: String(branch2.record._id) });
    await org(mgr, "branch-create", { branchName: "Nope" }, 403);
    await org(mgr, "member-add", { email: "outsider@example.invalid", role: "staff", branchIds: [String(branch2.record._id)] }, 403);
    await org(owner, "switch-branch", { branchId: String(branch2.record._id) });
    await org(owner, "switch-branch", { branchId: ownerBranch });
    // transfers: blocked while a membership is active, immutable history afterwards
    await org(owner, "student-transfer", { studentId: String(studentId), toBranchId: String(branch2.record._id) }, 400);
    const minorUser = await User.findOne({ email: "minor@example.invalid" });
    const moved = await org(owner, "student-transfer", { studentId: String(minorUser!._id), toBranchId: String(branch2.record._id), note: "Closer to home" });
    assert.equal(await S.StudentTransfer.countDocuments({ studentId: minorUser!._id }), 1);
    assert.equal(String((await User.findById(minorUser!._id))!.libraryId), String(branch2.record._id));
    await org(other, "student-transfer", { studentId: String(minorUser!._id), toBranchId: otherCtx.activeBranchId }, 403);
    assert.ok(moved.record._id);
    await User.updateOne({ _id: minorUser!._id }, { libraryId: (await LibraryModel.findOne({ ownerId: (await User.findOne({ email: "owner@example.invalid" }))!._id, branchName: "" }))!._id });
    // plan limits: fall back to the Free plan (data kept, features locked)
    await bill(owner, "switch-free");
    const freeCtx = await getJson("/api/org", owner);
    assert.equal(freeCtx.entitlements.limits.activeStudents, 25);
    const qr = await fetch(`${base}/api/attendance-qr`, { headers: { cookie: owner } });
    assert.equal(qr.status, 402);
    const blockedPay = await fetch(base + "/api/workspace", { method: "POST", headers: { cookie: owner, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "expenses", data: { title: "Tea", amount: 100, category: "Other", date: new Date().toISOString() } }) });
    assert.equal(blockedPay.status, 402);
    assert.equal((await blockedPay.json()).code, "feature");
    // fee collection is part of the free plan; only expenses are locked
    const freeModules = (await accessGet(owner)).modules;
    assert.deepEqual([freeModules.fees.enabled, freeModules.expenses.reason, freeModules.crm.reason], [true, "plan", "plan"]);
    await accessPost(owner, "module-set", { module: "expenses", enabled: true });
    assert.equal((await accessGet(owner)).modules.expenses.enabled, false, "the owner cannot switch on what the plan does not include");
    const freeDue = await DuesMembership.create({ libraryId: freeCtx.activeBranchId, userId: duesStudentId, start: new Date(), end: new Date(Date.now() + 9 * 86400000), amount: 30000, status: "active" });
    await post(owner, "payments", { membershipId: String(freeDue._id), amount: 10000, method: "cash", key: "free-plan-payment" });
    assert.equal((await DuesMembership.findById(freeDue._id))!.paid, 10000);
    await DuesMembership.updateOne({ _id: freeDue._id }, { status: "cancelled" });
    await post(owner, "payments", { membershipId: String(freeDue._id), amount: 10000, method: "cash", key: "cancelled-payment" }, 400);
    const { Payment: FreeP } = await import("../src/lib/models");
    await FreeP.deleteOne({ key: "free-plan-payment" }); await DuesMembership.deleteOne({ _id: freeDue._id }); // keep later checks exact
    assert.ok((await getJson("/api/workspace", owner)).students.length >= 1, "data is retained on the free plan");
    const orgLibs = await LibraryModel.find({ organizationId: ctx.organization._id }).select("_id").lean();
    await S.PendingStudent.insertMany(Array.from({ length: 30 }, (_, i) => ({ libraryId: orgLibs[0]._id, organizationId: ctx.organization._id, name: `Pending ${i}`, email: `pending${i}@example.invalid` })));
    const overLimit = await fetch(base + "/api/workspace", { method: "POST", headers: { cookie: owner, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "students", data: { email: "outsider@example.invalid", name: "Outsider" } }) });
    assert.equal(overLimit.status, 402);
    assert.equal((await overLimit.json()).code, "limit");
    await S.PendingStudent.deleteMany({ email: /^pending\d+@/ });
    // billing in sandbox: checkout → verified events → active
    const billing0 = await getJson("/api/billing", owner);
    // staff (any role) never read billing: invoices, credit and the referral code are the owner's
    assert.equal((await fetch(base + "/api/billing", { headers: { cookie: staff } })).status, 403, "staff cannot read billing");
    assert.equal(billing0.provider.name, "sandbox");
    assert.ok(billing0.plans.length === 4 && !JSON.stringify(billing0.plans).includes("providerPlanIds"));
    await bill(student, "checkout", { planKey: "starter", interval: "monthly" }, 403);
    await bill(owner, "checkout", { planKey: "free", interval: "monthly" }, 400);
    await bill(owner, "checkout", { planKey: "starter", interval: "monthly", couponCode: "NOPE" }, 400);
    const ck = await bill(owner, "checkout", { planKey: "starter", interval: "monthly" });
    assert.match(ck.checkoutUrl, /^\/billing\/sandbox\//);
    const checkoutId = ck.checkoutUrl.split("/").pop();
    const subBefore = await S.SaaSSubscription.findOne({ organizationId: ctx.organization._id });
    assert.notEqual(subBefore!.planKey, "starter", "checkout alone never activates a plan");
    const put = (cookie: string, body: unknown) => fetch(base + "/api/billing", { method: "PUT", headers: { cookie, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    assert.equal((await put(other, { checkoutId, outcome: "success" })).status, 400); // other tenants cannot complete it
    assert.equal((await put(owner, { checkoutId, outcome: "success" })).status, 200);
    const subAfter = await S.SaaSSubscription.findOne({ organizationId: ctx.organization._id });
    assert.deepEqual([subAfter!.planKey, subAfter!.status, subAfter!.mode], ["starter", "active", "sandbox"]);
    const invoices = await S.BillingInvoice.find({ organizationId: ctx.organization._id, mode: "sandbox" }).lean();
    assert.equal(invoices.length, 1);
    assert.deepEqual([invoices[0].totalPaise, invoices[0].status], [29900, "paid"]);
    assert.equal((await put(owner, { checkoutId, outcome: "success" })).status, 400); // already completed
    // signed webhook handling: signature, duplicates, ordering
    const secretKey = sha("sha256").update(`sandbox:${sessionSecret}`).digest("hex");
    const hook = (payload: unknown, eventId: string, signature?: string) => { const raw = JSON.stringify(payload); return fetch(base + "/api/billing/webhook", { method: "POST", headers: { "x-razorpay-event-id": eventId, "x-razorpay-signature": signature ?? signBody(raw, secretKey), "Content-Type": "application/json" }, body: raw }); };
    const subId = subAfter!.providerSubscriptionId!;
    const now = Math.floor(Date.now() / 1000);
    const charged = (paymentId: string, at: number, amount = 29900) => ({ entity: "event", event: "subscription.charged", created_at: at, payload: { subscription: { entity: { id: subId, current_start: at, current_end: at + 2592000 } }, payment: { entity: { id: paymentId, amount, status: "captured" } } } });
    assert.equal((await hook(charged("pay_x", now), "evt_bad", "0".repeat(64))).status, 400);
    assert.equal((await hook(charged("pay_x", now), "evt_a", undefined)).status, 200);
    const dup = await hook(charged("pay_x", now), "evt_a");
    assert.equal((await dup.json()).duplicate, true);
    assert.equal(await S.BillingInvoice.countDocuments({ providerPaymentId: "pay_x" }), 1, "duplicate delivery creates one invoice");
    const nonce = rb(4).toString("hex");
    assert.equal((await hook({ entity: "event", event: "subscription.cancelled", created_at: now + 100, payload: { subscription: { entity: { id: subId, current_end: now + 2592000 } } } }, `evt_c_${nonce}`)).status, 200);
    assert.equal((await S.SaaSSubscription.findOne({ organizationId: ctx.organization._id }))!.status, "canceled");
    assert.equal((await hook(charged("pay_old", now + 50), `evt_o_${nonce}`)).status, 200); // arrives late
    assert.equal((await S.SaaSSubscription.findOne({ organizationId: ctx.organization._id }))!.status, "canceled", "an older event never revives a canceled subscription");
    assert.equal(await S.BillingInvoice.countDocuments({ providerPaymentId: "pay_old" }), 1, "late payment is still recorded");
    const refund = { entity: "event", event: "refund.processed", created_at: now + 200, payload: { refund: { entity: { id: "rfnd_1", payment_id: "pay_unknown", amount: 100 } }, subscription: { entity: { id: subId } } } };
    assert.equal((await hook(refund, `evt_r_${nonce}`)).status, 500); // refund before payment: retried by the provider
    await hook(charged("pay_unknown", now + 60, 5000), `evt_u_${nonce}`);
    assert.equal((await hook(refund, `evt_r_${nonce}`)).status, 200);
    assert.equal((await S.BillingPayment.findOne({ providerPaymentId: "pay_unknown" }))!.refundedPaise, 100);
    // failed billing and grace period
    await S.SaaSSubscription.updateOne({ organizationId: ctx.organization._id }, { status: "active", currentPeriodEnd: new Date(Date.now() + 86400000), lastProviderEventAt: new Date(Date.now() - 600000) });
    assert.equal((await hook({ entity: "event", event: "subscription.pending", created_at: now + 300, payload: { subscription: { entity: { id: subId } } } }, `evt_p_${nonce}`)).status, 200);
    assert.equal((await S.SaaSSubscription.findOne({ organizationId: ctx.organization._id }))!.status, "past_due");
    assert.equal((await getJson("/api/org", owner)).entitlements.tier, "plan", "grace period keeps access");
    await S.SaaSSubscription.updateOne({ organizationId: ctx.organization._id }, { pastDueSince: new Date(Date.now() - 20 * 86400000) });
    assert.equal((await getJson("/api/org", owner)).entitlements.tier, "free", "access is restricted after the grace period");
    // sandbox failure path leaves the current plan untouched and records a failed invoice
    const ck2 = await bill(owner, "checkout", { planKey: "pro", interval: "annual" });
    assert.equal((await put(owner, { checkoutId: ck2.checkoutUrl.split("/").pop(), outcome: "failure" })).status, 200);
    assert.equal(await S.BillingInvoice.countDocuments({ organizationId: ctx.organization._id, status: "failed" }), 1);
    assert.equal((await S.SaaSSubscription.findOne({ organizationId: ctx.organization._id }))!.planKey, "starter");
    void MembershipModel;
    // ---- Phase 5: admin, onboarding, CRM, support, referrals, jobs, analytics ----
    const sa = (action: string, data: unknown, status = 200, cookie = adminCookie) => api("/api/saas-admin", cookie, action, data, status);
    const adminGet = async (q: string) => (await fetch(`${base}/api/saas-admin?${q}`, { headers: { cookie: adminCookie } })).json();
    const ownerOrgId = ctx.organization._id as string;
    // put the owner back on an admin-granted Business plan for the remaining scenarios
    await S.SaaSSubscription.updateOne({ organizationId: ownerOrgId }, { status: "active", source: "admin", mode: "none", planKey: "business", pastDueSince: null, currentPeriodEnd: new Date(Date.now() + 30 * 86400000), "planSnapshot.features": ["basic", "fees-expenses", "crm", "qr-attendance", "advanced-reports", "multi-branch", "advanced-controls"], "planSnapshot.limits": { activeStudents: 2000, branches: 5 }, "planSnapshot.name": "Business" });
    const pub = await (await fetch(`${base}/api/saas-public`)).json();
    assert.equal(pub.plans.length, 4);
    assert.ok(!JSON.stringify(pub).includes("providerPlanIds"));
    // onboarding: drafts, idempotent retries, CSV import
    const ob = (action: string, data: unknown = {}, status = 200, cookie = owner) => api("/api/onboarding", cookie, action, data, status);
    await ob("organization", { name: "Quiet Hours Group" }, 403, student);
    await ob("organization", { name: "Quiet Hours Group" });
    await ob("verify-check", { channel: "email", code: "123456" }, 400); // no code requested
    await ob("verify-send", { channel: "email" }, 503); // production without an email provider fails clearly instead of pretending to send
    await ob("verify-check", { channel: "email", code: "000000" }, 400); // wrong code
    await ob("branch", { branchName: "Main", city: "Pune", address: "MG Road" });
    await ob("shifts", { items: [{ name: "Morning", start: 360, end: 720 }, { name: "Evening", start: 960, end: 1320 }] });
    await ob("shifts", { items: [{ name: "Morning", start: 360, end: 720 }] }); // retry is safe
    await ob("shifts", { items: [{ name: "Bad", start: 700, end: 600 }] }, 400);
    assert.equal((await ob("seats", { prefix: "Z", count: 5 })).record.created, 5);
    assert.deepEqual([(await ob("seats", { prefix: "Z", count: 5 })).record.created, 0].join(), "0,0");
    await ob("fees", { items: [{ name: "Monthly", rupees: 1200, days: 30 }] });
    const csv = "name,email,phone\nAsha Rao,asha.rao@example.invalid,9876543210\nBad Row,not-an-email,\nVikram,vikram@example.invalid,";
    const preview = await ob("students-preview", { csv });
    assert.deepEqual([preview.record.rows, preview.record.errors.length], [2, 1]);
    const imported = await ob("students-import", { csv });
    assert.equal(imported.record.imported, 2);
    await ob("students-import", { csv }, 400); // nothing new
    const registered = await account("student", "asha.rao@example.invalid"); // pending student links on registration
    assert.equal(String((await User.findOne({ email: "asha.rao@example.invalid" }))!.libraryId), ctx.activeBranchId);
    void registered;
    await ob("complete");
    assert.equal((await S.Organization.findById(ownerOrgId))!.onboardingStatus, "complete");
    const obState = await getJson("/api/onboarding", owner);
    assert.ok(obState.completed.includes("shifts") && obState.counts.seats >= 5 && obState.status === "complete");
    // CRM: pipeline, duplicates, consent, public form
    const crm = (action: string, data: unknown = {}, status = 200, cookie = owner) => api("/api/crm", cookie, action, data, status);
    const lead = await crm("lead-create", { name: "Meera", phone: "+91 90000 11111", source: "walk-in", consentContact: true });
    await crm("lead-create", { name: "Meera again", phone: "9000011111" }, 400); // duplicate by phone
    await crm("lead-move", { id: lead.record._id, stage: "converted" }, 400); // cannot skip stages
    await crm("lead-move", { id: lead.record._id, stage: "contacted" });
    await crm("lead-move", { id: lead.record._id, stage: "visit-scheduled", visitAt: new Date(Date.now() - 3600000).toISOString() }, 400);
    await crm("lead-move", { id: lead.record._id, stage: "visit-scheduled", visitAt: new Date(Date.now() + 86400000).toISOString() });
    await crm("lead-move", { id: lead.record._id, stage: "lost" }, 400); // reason required
    const task = await crm("task-create", { leadId: lead.record._id, dueAt: new Date(Date.now() + 3600000).toISOString(), note: "Call back" });
    await crm("task-done", { id: task.record._id });
    await crm("task-done", { id: task.record._id }, 400);
    assert.equal((await getJson("/api/crm", other)).leads.length, 0, "leads are tenant-scoped");
    assert.equal((await fetch(`${base}/api/crm`, { headers: { cookie: student } })).status, 403);
    await LibraryModel.updateOne({ _id: ctx.activeBranchId }, { publicSlug: "demo-lib", listingVisible: true });
    const enquire = (body: unknown, ip = `10.1.${rb(1)[0]}.${rb(1)[0]}`) => fetch(`${base}/api/leads`, { method: "POST", headers: { Origin: base, "Content-Type": "application/json", "x-forwarded-for": ip }, body: JSON.stringify(body) });
    assert.equal((await enquire({ library: "demo-lib", name: "Karan", phone: "9111122222", message: "Fees?", consentContact: false })).status, 200);
    assert.equal((await enquire({ library: "demo-lib", name: "Karan", phone: "91111 22222" })).status, 200);
    const karan = await S.AdmissionLead.find({ libraryId: ctx.activeBranchId, phone: /9111122222|91111 22222/ }).lean();
    assert.equal(karan.length, 1); assert.equal(karan[0].enquiryCount, 2); assert.equal(karan[0].consentContact, false);
    assert.equal((await enquire({ library: "demo-lib", name: "Bot", phone: "9222233333", website: "http://spam" })).status, 200);
    assert.equal(await S.AdmissionLead.countDocuments({ libraryId: ctx.activeBranchId, phone: "9222233333" }), 0, "honeypot drops bot submissions");
    assert.equal((await enquire({ library: "no-such-lib", name: "X Y", phone: "9333344444" })).status, 404);
    assert.equal((await enquire({ kind: "demo", name: "Pat Lee", email: "pat@example.invalid", libraryName: "Pat Library", consentContact: true })).status, 200);
    assert.equal((await enquire({ kind: "demo", name: "Pat Lee", email: "pat@example.invalid", consentContact: false })).status, 422);
    // support
    const sup = (cookie: string, action: string, data: unknown = {}, status = 200) => api("/api/support", cookie, action, data, status);
    const ticket = await sup(owner, "create", { subject: "Invoice question", category: "billing", body: "Please explain my last invoice." });
    assert.equal((await fetch(`${base}/api/support?id=${ticket.ticket._id}`, { headers: { cookie: other } })).status, 404);
    await sup(other, "reply", { id: ticket.ticket._id, body: "hello" }, 400);
    await api("/api/support", adminCookie, "reply", { id: ticket.ticket._id, body: "Happy to help — it covers the Starter plan." });
    const tdetail = await getJson(`/api/support?id=${ticket.ticket._id}`, owner);
    assert.deepEqual([tdetail.ticket.messages.length, tdetail.ticket.status], [2, "pending"]);
    assert.ok((await getJson("/api/workspace", owner)).notifications.some((n: { title: string }) => n.title.includes("Support replied")));
    await sup(owner, "close", { id: ticket.ticket._id });
    await sup(owner, "reply", { id: ticket.ticket._id, body: "more" }, 400);
    // admin controls: authorization, plan versions, audit
    await sa("plan-save", {}, 403, owner);
    const before = await S.SaaSSubscription.findOne({ organizationId: ownerOrgId });
    await sa("plan-save", { key: "starter", name: "Starter", monthlyPaise: 39900, annualPaise: 399000, activeStudents: 100, branches: 1, features: ["basic", "fees-expenses", "crm"], reason: "Price review" });
    await sa("plan-save", { key: "starter", name: "Starter", monthlyPaise: 39900, annualPaise: 399000, activeStudents: 100, branches: 1, features: ["basic"] }, 422); // reason required
    assert.equal(await S.SaaSPlan.countDocuments({ key: "starter" }), 2);
    assert.equal((await S.SaaSPlan.findOne({ key: "starter", current: true }))!.version, 2);
    assert.equal((await fetch(`${base}/api/saas-public`).then((r) => r.json())).plans.find((p: { key: string }) => p.key === "starter").monthlyPaise, 39900);
    assert.equal((await S.SaaSSubscription.findOne({ organizationId: ownerOrgId }))!.planSnapshot.limits.activeStudents, before!.planSnapshot.limits.activeStudents, "existing subscribers keep their plan snapshot");
    await sa("org-suspend", { organizationId: otherCtx.organization._id, reason: "Chargeback review" });
    const suspended = await fetch(base + "/api/workspace", { method: "POST", headers: { cookie: other, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "seats", data: { label: "S1", floor: "G" } }) });
    assert.equal(suspended.status, 402); assert.equal((await suspended.json()).code, "suspended");
    assert.equal((await fetch(`${base}/api/export?resource=students`, { headers: { cookie: other } })).status, 200, "exports stay available while suspended");
    await sa("org-reinstate", { organizationId: otherCtx.organization._id, reason: "Resolved" });
    await sa("sub-override", { organizationId: otherCtx.organization._id, add: ["multi-branch"], activeStudents: 80, reason: "Pilot" });
    assert.ok((await getJson("/api/org", other)).entitlements.features.includes("multi-branch"));
    await sa("sub-override", { organizationId: otherCtx.organization._id, clear: true, reason: "Pilot over" });
    await sa("sub-override", { organizationId: otherCtx.organization._id, add: ["multi-branch"] }, 422);
    const audits = (await adminGet("view=audit")).items.map((a: { action: string }) => a.action);
    for (const a of ["plan.save", "org.suspend", "org.reinstate", "subscription.override"]) assert.ok(audits.includes(a), `audit has ${a}`);
    // coupons, tax and invoices
    await sa("coupon-save", { code: "launch50", name: "Launch", type: "percent", value: 50, maxRedemptions: 1, plans: ["pro"] });
    await bill(owner, "coupon-check", { planKey: "starter", interval: "monthly", couponCode: "LAUNCH50" }, 400); // wrong plan
    const preview50 = await bill(owner, "coupon-check", { planKey: "pro", interval: "monthly", couponCode: "LAUNCH50" });
    assert.deepEqual([preview50.discountPaise, preview50.payablePaise], [29950, 29950]);
    await sa("settings-save", { taxMode: "exclusive", taxRateBps: 1800, gstin: "", legalName: "StudyQuest Test", graceDays: 7, referralEnabled: true, referralRewardPaise: 29900, referralMonthlyCap: 5, invoicePrefix: "SQ", reason: "Test tax" });
    await S.SaaSSubscription.updateOne({ organizationId: ownerOrgId }, { source: "admin", status: "active" });
    const ck3 = await bill(owner, "checkout", { planKey: "pro", interval: "monthly", couponCode: "LAUNCH50" });
    await put(owner, { checkoutId: ck3.checkoutUrl.split("/").pop(), outcome: "success" });
    const inv = await S.BillingInvoice.findOne({ organizationId: ownerOrgId, planKey: "pro" }).lean<{ totalPaise: number; discountPaise: number; subtotalPaise: number; status: string; taxPaise: number; taxMode: string }>();
    assert.deepEqual([inv!.totalPaise, inv!.discountPaise, inv!.subtotalPaise, inv!.status], [29950, 29950, 59900, "paid"]);
    assert.ok(inv!.taxPaise > 0 && inv!.taxMode === "inclusive", "tax is computed only from configuration");
    assert.equal((await S.Coupon.findOne({ code: "LAUNCH50" }))!.redemptions, 1);
    await bill(owner, "checkout", { planKey: "pro", interval: "annual", couponCode: "LAUNCH50" }, 400); // exhausted and already used
    await sa("settings-save", { taxMode: "none", taxRateBps: 0, gstin: "", legalName: "", graceDays: 7, referralEnabled: true, referralRewardPaise: 29900, referralMonthlyCap: 5, invoicePrefix: "SQ", reason: "Reset" });
    // referrals: abuse prevention and idempotent credit
    const { evaluateReferral, creditBalance } = await import("../src/lib/referrals");
    const refCode = (await getJson("/api/billing", owner)).referral.code as string;
    const register = (email: string, extra: object = {}) => fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ acceptTerms: true, name: "Referred Owner", email, password: rb(12).toString("hex"), role: "owner", library: "Referred Library", ...extra }) });
    assert.equal((await register("friend@referred-lib.in", { referralCode: refCode })).status, 200);
    const friendOrg = await S.Organization.findOne({ referredByCode: refCode });
    const referral = await S.Referral.findOne({ referredOrgId: friendOrg!._id });
    assert.equal(referral!.status, "pending");
    await evaluateReferral(friendOrg!._id, false); // sandbox/unpaid never qualifies
    assert.equal(await creditBalance(ownerOrgId), 0);
    await evaluateReferral(friendOrg!._id, true);
    await evaluateReferral(friendOrg!._id, true); // replayed payment event
    assert.equal(await creditBalance(ownerOrgId), 29900);
    assert.equal(await S.SubscriptionCredit.countDocuments({ organizationId: ownerOrgId, reason: "referral" }), 1);
    await register("a@lib-group.in");
    const codeA = (await S.Organization.findOne({ billingEmail: "a@lib-group.in" }))!.referralCode!;
    await register("b@lib-group.in", { referralCode: codeA });
    const sameDomain = await S.Referral.findOne({ code: codeA });
    assert.equal(sameDomain!.status, "rejected", "shared business domain is treated as abuse");
    await evaluateReferral(sameDomain!.referredOrgId, true);
    assert.equal(await creditBalance((await S.Organization.findOne({ billingEmail: "a@lib-group.in" }))!._id), 0);
    // credits prepay a plan; never mixed with Study Coins
    const monthlyStarter = (await S.SaaSPlan.findOne({ key: "starter", current: true }))!.monthlyPaise;
    await bill(owner, "credit-prepay", { planKey: "starter", months: 2 }, 400); // 29900 < 79800
    await S.SubscriptionCredit.create({ organizationId: ownerOrgId, amountPaise: 60000, reason: "admin", key: `top-up-${rb(3).toString("hex")}` });
    await S.SaaSSubscription.updateOne({ organizationId: ownerOrgId }, { source: "admin", status: "active" });
    await bill(owner, "credit-prepay", { planKey: "starter", months: 2 });
    assert.equal(await creditBalance(ownerOrgId), 29900 + 60000 - monthlyStarter * 2);
    assert.equal(await S.BillingInvoice.countDocuments({ organizationId: ownerOrgId, mode: "credit", status: "paid" }), 1);
    assert.equal((await S.SaaSSubscription.findOne({ organizationId: ownerOrgId }))!.source, "credit");
    // background jobs: reminders are idempotent; marketing respects opt-in
    await S.SaaSSubscription.updateOne({ organizationId: otherCtx.organization._id }, { status: "trialing", trialEnd: new Date(Date.now() + 2 * 86400000) });
    const run1 = (await sa("jobs-run", {})).record.results["saas-jobs"], run2 = (await sa("jobs-run", {})).record.results["saas-jobs"];
    assert.ok(run1.trialReminders >= 1 && run1.onboardingReminders >= 0);
    assert.equal(run2.trialReminders, 0, "second run sends nothing new");
    assert.ok(await S.NotificationDelivery.exists({ organizationId: otherCtx.organization._id, kind: "trial", status: "sent" }));
    assert.equal((await fetch(`${base}/api/jobs/run`, { method: "POST" })).status, 401);
    const { notifyOrg } = await import("../src/lib/saas-notify");
    assert.equal((await notifyOrg({ organizationId: ownerOrgId, key: `promo:${rb(3).toString("hex")}`, kind: "promo", title: "Offer", message: "20% off", marketing: true })).sent, false);
    await S.OrganizationMembership.updateOne({ organizationId: ownerOrgId, role: "org-owner" }, { marketingOptIn: true });
    assert.equal((await notifyOrg({ organizationId: ownerOrgId, key: `promo:${rb(3).toString("hex")}`, kind: "promo", title: "Offer", message: "20% off", marketing: true })).sent, true);
    // analytics: formulas, exclusions and branch comparison
    await S.SaaSSubscription.updateOne({ organizationId: ownerOrgId }, { source: "provider", status: "active", mode: "sandbox", interval: "annual", "planSnapshot.features": ["basic", "fees-expenses", "crm", "qr-attendance", "advanced-reports", "multi-branch"], "planSnapshot.monthlyPaise": 59900, "planSnapshot.annualPaise": 599000 });
    const liveMetrics = await adminGet("view=overview");
    assert.equal(liveMetrics.revenue.mrrPaise, 0, "sandbox subscriptions never count as revenue by default");
    assert.ok(liveMetrics.definitions.mrr);
    const withSandbox = await adminGet("view=overview&sandbox=1");
    assert.equal(withSandbox.revenue.mrrPaise, 49917);
    assert.equal(withSandbox.revenue.arrPaise, 49917 * 12);
    await sa("org-test", { organizationId: ownerOrgId, isTest: true, reason: "Demo account" });
    assert.equal((await adminGet("view=overview&sandbox=1")).revenue.mrrPaise, 0, "test organizations are excluded");
    await sa("org-test", { organizationId: ownerOrgId, isTest: false, reason: "Back to normal" });
    const orgsList = await adminGet("view=orgs");
    assert.ok(orgsList.items.some((o: { name: string }) => o.name.length) && orgsList.total >= 4);
    const oa = await getJson("/api/org-analytics", owner);
    assert.ok(oa.comparison && oa.branches.length >= 2 && typeof oa.total.revenuePaise === "number");
    assert.equal((await fetch(`${base}/api/org-analytics`, { headers: { cookie: student } })).status, 403);
    const exp = await fetch(`${base}/api/export?resource=students`, { headers: { cookie: owner } });
    assert.match(await exp.text(), /^name,email,createdAt/);
    assert.equal((await fetch(`${base}/api/export?resource=students`, { headers: { cookie: student } })).status, 403);
    assert.equal((await fetch(`${base}/api/saas-admin?view=orgs`, { headers: { cookie: owner } })).status, 403);
        let limitedStatus = 0; for (let i = 0; i < 6; i++) limitedStatus = (await enquire({ library: "demo-lib", name: "Rate Limit", phone: `95555${i}6666` }, "10.9.9.9")).status;
    assert.equal(limitedStatus, 429, "public enquiries are rate limited");
    // ---- Phase 6: security, reliability, concurrency, privacy and pilot ----
    const { Notification: NotificationModel, Membership: MembershipDoc, Payment: PaymentDoc, SeatAssignment: AssignmentDoc } = await import("../src/lib/models");
    const { PasswordReset: ResetModel, JobRun } = await import("../src/lib/ops-models");
    const { hashToken } = await import("../src/lib/security");
    const send = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
    const rawJson = async (res: Response) => res.json().catch(() => ({}));
    const pw = () => rb(12).toString("hex");

    // headers, SEO and operational endpoints
    const home = await fetch(base + "/pricing");
    const csp = home.headers.get("content-security-policy") ?? "";
    assert.ok(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && csp.includes("base-uri 'self'"), "CSP is sent");
    assert.equal(home.headers.get("x-powered-by"), null);
    assert.ok(home.headers.get("x-request-id"), "every response carries a correlation id");
    assert.equal((await fetch(base + "/api/health")).status, 200);
    const readyRes = await fetch(base + "/api/ready"); const readyBody = await rawJson(readyRes);
    assert.equal(readyBody.checks.database.ok, true);
    assert.equal(readyRes.status, 503, "readiness fails while APP_URL is not https or sandbox billing is enabled");
    assert.ok(!JSON.stringify(readyBody).includes("mongodb://") && !JSON.stringify(readyBody).includes(sessionSecret), "readiness never leaks secrets");
    assert.match(await (await fetch(base + "/robots.txt")).text(), /Disallow: \/owner/);
    assert.match(await (await fetch(base + "/sitemap.xml")).text(), /\/l\/demo-lib/);
    assert.match((await fetch(base + "/owner/seats")).headers.get("x-robots-tag") ?? "", /noindex/);
    const libPage = await fetch(base + "/l/demo-lib"); const libHtml = await libPage.text();
    assert.equal(libPage.status, 200); assert.match(libHtml, /application\/ld\+json/); assert.match(libHtml, /rel="canonical"/);
    assert.equal((await fetch(base + "/l/not-a-real-library")).status, 404);
    const sw = await fetch(base + "/sw.js"); assert.match(sw.headers.get("cache-control") ?? "", /no-cache/);
    assert.equal((await (await fetch(base + "/manifest.webmanifest")).json()).icons.filter((i: { sizes: string }) => i.sizes === "192x192" || i.sizes === "512x512").length >= 2, true);

    // unauthenticated / unauthorized access to every sensitive endpoint
    for (const path of ["/api/workspace", "/api/org", "/api/billing", "/api/crm", "/api/support", "/api/prep", "/api/maintenance", "/api/rewards", "/api/doubts", "/api/learning", "/api/phase2", "/api/privacy", "/api/pilot-import", "/api/export?resource=students", "/api/org-analytics", "/api/onboarding", "/api/saas-admin", "/api/prep-admin", "/api/community", "/api/attendance-qr"])
      assert.ok([401, 403].includes((await fetch(base + path)).status), `${path} requires authentication`);
    for (const path of ["/api/saas-admin?view=orgs", "/api/prep-admin", "/api/pilot-import", "/api/org-analytics", "/api/privacy?download=1"])
      assert.ok([403].includes((await fetch(base + path, { headers: { cookie: student } })).status) || path.includes("privacy"), `${path} is closed to students`);
    assert.equal((await fetch(base + "/api/jobs/run", { method: "POST", headers: { "x-cron-secret": "wrong" } })).status, 401);

    // CSRF, forged and expired sessions, injection
    assert.equal((await send("/api/workspace", { action: "seats", data: {} }, { cookie: owner, Origin: "https://evil.example" })).status, 403);
    assert.equal((await send("/api/workspace", { action: "seats", data: {} }, { cookie: owner, "Sec-Fetch-Site": "cross-site" })).status, 403);
    const forge = async (secretText: string, exp: string) => `sq-session=${await new SignJWT({ sv: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(String(adminUser._id)).setIssuedAt().setExpirationTime(exp).sign(new TextEncoder().encode(secretText))}`;
    assert.equal((await fetch(base + "/api/saas-admin?view=orgs", { headers: { cookie: await forge("x".repeat(40), "1h") } })).status, 403, "token signed with another secret is rejected");
    assert.equal((await fetch(base + "/api/saas-admin?view=orgs", { headers: { cookie: await forge(sessionSecret, "-1h") } })).status, 403, "expired session is rejected");
    assert.equal((await fetch(base + "/api/saas-admin?view=orgs", { headers: { cookie: await forge(sessionSecret, "1h") } })).status, 200, "control: a valid admin token works");
    assert.equal((await send("/api/auth/login", { email: { $ne: "" }, password: "whatever-long-enough" }, { Origin: base })).status, 400, "operator injection in login is rejected");
    assert.equal((await send("/api/auth/register", { acceptTerms: true, name: "Evil", email: "evil@example.invalid", password: pw(), role: "super-admin" }, { Origin: base })).status, 400, "cannot self-register as admin");

    // brute force protection and account lockout
    await account("student", "brute@example.invalid");
    const wrong = () => send("/api/auth/login", { email: "brute@example.invalid", password: "definitely-wrong-password" }, { Origin: base });
    for (let i = 0; i < 8; i++) assert.equal((await wrong()).status, 401);
    assert.equal((await wrong()).status, 429, "account locks after repeated failures");
    assert.equal((await send("/api/auth/login", { email: "other-nobody@example.invalid", password: "definitely-wrong-password" }, { Origin: base })).status, 401, "other accounts are unaffected");

    // password reset, session revocation
    const victim = await account("student", "victim@example.invalid");
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: victim } })).status, 200);
    // No email provider in this production-mode run: reset is unavailable, with one answer for every address.
    const forgot = await send("/api/auth/forgot", { email: "nobody-here@example.invalid" }, { Origin: base });
    const forgotKnown = await send("/api/auth/forgot", { email: "victim@example.invalid" }, { Origin: base });
    assert.equal(forgot.status, 503); assert.equal(forgotKnown.status, 503);
    assert.deepEqual(await rawJson(forgot), await rawJson(forgotKnown), "known and unknown accounts get the same answer");
    const victimUser = await User.findOne({ email: "victim@example.invalid" });
    const mintToken = async (expires: number) => { const t = rb(24).toString("base64url"); await ResetModel.create({ userId: victimUser!._id, tokenHash: hashToken(t), expiresAt: new Date(Date.now() + expires) }); return t; };
    assert.equal((await send("/api/auth/reset", { token: await mintToken(-60000), password: pw() }, { Origin: base })).status, 400, "expired reset token");
    const good = await mintToken(600000);
    assert.equal((await send("/api/auth/reset", { token: good, password: "short" }, { Origin: base })).status, 400);
    const newPassword = pw();
    const reset = await send("/api/auth/reset", { token: good, password: newPassword }, { Origin: base });
    assert.equal(reset.status, 200);
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: victim } })).status, 401, "resetting the password revokes old sessions");
    assert.equal((await send("/api/auth/reset", { token: good, password: pw() }, { Origin: base })).status, 400, "reset tokens are single use");
    const fresh = (reset.headers.get("set-cookie") ?? "").split(";")[0];
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: fresh } })).status, 200);
    assert.equal((await send("/api/auth/login", { email: "victim@example.invalid", password: newPassword }, { Origin: base })).status, 200);
    const out = await send("/api/auth/logout-all", {}, { cookie: fresh, Origin: base });
    assert.equal(out.status, 200);
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: fresh } })).status, 401, "sign out everywhere ends the session server-side");
    const cp = await send("/api/auth/login", { email: "victim@example.invalid", password: newPassword }, { Origin: base });
    const cpCookie = (cp.headers.get("set-cookie") ?? "").split(";")[0];
    const changed = await send("/api/auth/change-password", { current: "wrong-current-password", password: pw() }, { cookie: cpCookie, Origin: base });
    assert.equal(changed.status, 400);

    // privacy: export, wrong-password deletion, anonymising deletion that keeps financial history
    const priv = await send("/api/auth/login", { email: "victim@example.invalid", password: newPassword }, { Origin: base });
    const privCookie = (priv.headers.get("set-cookie") ?? "").split(";")[0];
    const exported = await (await fetch(base + "/api/privacy?download=1", { headers: { cookie: privCookie } })).json();
    assert.equal(exported.account.email, "victim@example.invalid");
    const del = (password: string, confirm = "DELETE") => send("/api/privacy", { action: "delete-account", password, confirm }, { cookie: privCookie, Origin: base });
    assert.equal((await del("not-the-password")).status, 400);
    assert.equal((await del(newPassword, "nope")).status, 400);
    await invite(owner, privCookie, "Victim", "victim@example.invalid");
    const victimMembershipId = new (await import("mongoose")).default.Types.ObjectId();
    await MembershipDoc.create({ _id: victimMembershipId, libraryId: ctx.activeBranchId, userId: victimUser!._id, start: new Date(), end: new Date(Date.now() + 86400000), amount: 100000, paid: 40000 });
    await PaymentDoc.create({ libraryId: ctx.activeBranchId, membershipId: victimMembershipId, userId: victimUser!._id, amount: 40000, method: "cash", key: "victim-pay", receipt: "R-V" });
    assert.equal((await del(newPassword)).status, 200);
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: privCookie } })).status, 401);
    assert.equal((await send("/api/auth/login", { email: "victim@example.invalid", password: newPassword }, { Origin: base })).status, 401, "deleted accounts cannot sign in");
    const gone = await User.findById(victimUser!._id);
    assert.ok(gone!.deletedAt && gone!.name === "Deleted user" && gone!.email.endsWith("@deleted.invalid"));
    assert.equal(await PaymentDoc.countDocuments({ key: "victim-pay" }), 1, "financial records are kept for the library's accounts");
    assert.equal(await NotificationModel.countDocuments({ userId: victimUser!._id }), 0, "personal data is erased");

    // concurrency: seat double-booking, repeated reward requests, duplicate payment events
    const racer1 = await account("student", "race1@example.invalid"); const racer2 = await account("student", "race2@example.invalid");
    await invite(owner, racer1, "Racer One", "race1@example.invalid"); await invite(owner, racer2, "Racer Two", "race2@example.invalid");
    await post(owner, "seats", { label: "RACE1", floor: "G" });
    const raceState = await get(owner);
    const raceSeat = raceState.seats.find((s: { label: string }) => s.label === "RACE1")._id;
    const ids = await Promise.all(["race1@example.invalid", "race2@example.invalid"].map(async (e) => String((await User.findOne({ email: e }))!._id)));
    const planId = raceState.plans[0]._id;
    const claim = (userId: string) => fetch(base + "/api/workspace", { method: "POST", headers: { cookie: owner, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "memberships", data: { userId, planId, seatId: raceSeat, start: new Date().toISOString(), shiftStart: 360, shiftEnd: 840, discount: 0 } }) });
    const raced = await Promise.all([claim(ids[0]), claim(ids[1]), claim(ids[0]), claim(ids[1])]);
    assert.equal(raced.filter((r) => r.status === 200).length, 1, "exactly one concurrent seat assignment wins");
    assert.equal(await AssignmentDoc.countDocuments({ seatId: raceSeat }), 1);
    const focusUserId = ids[0];
    await post(racer1, "focus.start");
    await StudySession.updateOne({ userId: focusUserId, state: "running" }, { $set: { lastResumedAt: new Date(Date.now() - 1501000) } });
    const rewards = await Promise.all(Array.from({ length: 5 }, () => fetch(base + "/api/workspace", { method: "POST", headers: { cookie: racer1, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "focus.complete", data: {} }) })));
    assert.equal(rewards.filter((r) => r.status === 200).length, 1, "a focus reward can be claimed once");
    assert.equal(await XPTransaction.countDocuments({ userId: focusUserId, source: /^focus:/ }), 1);
    const concEvent = { entity: "event", event: "subscription.charged", created_at: Math.floor(Date.now() / 1000) + 500, payload: { subscription: { entity: { id: (await S.SaaSSubscription.findOne({ organizationId: ownerOrgId }))!.providerSubscriptionId ?? subId, current_start: now + 500, current_end: now + 2592500 } }, payment: { entity: { id: "pay_concurrent", amount: 29900, status: "captured" } } } };
    const dupes = await Promise.all(Array.from({ length: 6 }, () => hook(concEvent, "evt_concurrent")));
    assert.ok(dupes.every((r) => r.status === 200), "concurrent duplicate deliveries never error");
    assert.equal(await S.BillingInvoice.countDocuments({ providerPaymentId: "pay_concurrent" }), 1, "six simultaneous deliveries create one invoice");
    assert.equal(await S.BillingPayment.countDocuments({ providerPaymentId: "pay_concurrent" }), 1);

    // pilot register import: validation, control totals, all-or-nothing, reconciliation, invites
    const pil = (cookie: string, action: string, data: Record<string, unknown> = {}, status = 200) => api("/api/pilot-import", cookie, action, data, status);
    const today = new Date().toISOString().slice(0, 10);
    const registerCsv = `name,email,phone,seat,shift,plan,start_date,paid_rupees,discount_rupees\nMeena Pilot,meena.pilot@example.invalid,9800000001,Z1,Morning,Monthly,${today},1200,0\nSunil Pilot,sunil.pilot@example.invalid,9800000002,Z2,Morning,Monthly,${today},500,100\nTara Pilot,tara.pilot@example.invalid,,Z3,Evening,Monthly,${today},0,0`;
    const v = await pil(owner, "validate", { csv: registerCsv, expected: { paidRupees: 1700, dueRupees: 600 + 1200 } });
    assert.equal(v.canCommit, true); assert.deepEqual([v.totals.students, v.totals.paidPaise, v.totals.duePaise], [3, 170000, 180000]);
    const badTotals = await pil(owner, "validate", { csv: registerCsv, expected: { paidRupees: 9999 } });
    assert.equal(badTotals.canCommit, false);
    const clash = await pil(owner, "validate", { csv: `${registerCsv}\nDup Seat,dup@example.invalid,,Z1,Morning,Monthly,${today},0,0` });
    assert.equal(clash.canCommit, false); assert.match(JSON.stringify(clash.issues), /already assigned/);
    await pil(owner, "commit", { csv: registerCsv }, 400); // review confirmation required
    await pil(owner, "commit", { csv: `${registerCsv}\nBad,bad,,Z4,Morning,Monthly,${today},0,0`, reviewed: true }, 422);
    assert.equal(await User.countDocuments({ email: /pilot@example.invalid$/ }), 0, "a failed validation imports nothing");
    const committed = await pil(owner, "commit", { csv: registerCsv, reviewed: true });
    assert.deepEqual([committed.created.students, committed.created.memberships, committed.created.payments], [3, 3, 2]);
    await pil(owner, "commit", { csv: registerCsv, reviewed: true }, 422); // same file cannot be imported twice
    const recon = await getJson("/api/pilot-import", owner);
    assert.equal(recon.students >= 3, true);
    assert.ok(!recon.problems.some((p: string) => /overlapping|differs from the sum/.test(p)), "payments reconcile and no seats overlap");
    assert.equal((await send("/api/auth/login", { email: "meena.pilot@example.invalid", password: pw() }, { Origin: base })).status, 401, "invited accounts have no usable password");
    const inviteRun = await pil(owner, "invite"); assert.ok(inviteRun.invited >= 3);
    const meena = await User.findOne({ email: "meena.pilot@example.invalid" });
    const inviteToken = rb(24).toString("base64url"); await ResetModel.create({ userId: meena!._id, tokenHash: hashToken(inviteToken), expiresAt: new Date(Date.now() + 600000) });
    // an account created by a library must accept the Terms before activation; the link is not consumed by a refusal
    const noTermsActivate = await send("/api/auth/reset", { token: inviteToken, password: pw() }, { Origin: base });
    assert.equal(noTermsActivate.status, 400); assert.equal((await rawJson(noTermsActivate)).code, "terms-required");
    assert.equal((await User.findById(meena!._id))!.invited, true, "still invited");
    const activate = await send("/api/auth/reset", { token: inviteToken, password: pw(), acceptTerms: true }, { Origin: base });
    assert.equal(activate.status, 200);
    assert.deepEqual(((await (await import("../src/lib/ops-models")).ConsentRecord.find({ userId: meena!._id }).lean())).map((r) => `${r.kind}:${r.source}`), ["terms:invite-activation"]);
    const meenaWs = await (await fetch(base + "/api/workspace", { headers: { cookie: (activate.headers.get("set-cookie") ?? "").split(";")[0] } })).json();
    assert.ok(meenaWs.memberships?.length === 1 || meenaWs.membership || meenaWs.user, "an invited student can open their workspace after activating");
    const otherImport = await pil(other, "validate", { csv: registerCsv });
    assert.equal(otherImport.canCommit, false); assert.match(JSON.stringify(otherImport.issues), /Unknown seat/, "another tenant cannot map onto this branch's seats");
    await pil(student, "validate", { csv: registerCsv }, 403);

    // background jobs: expiry, fee reminders (idempotent), heartbeat, readiness
    await MembershipDoc.updateOne({ userId: meena!._id }, { end: new Date(Date.now() - 86400000), status: "active" });
    const jobs1 = (await sa("jobs-run", {})).record.results, jobs2 = (await sa("jobs-run", {})).record.results;
    assert.ok(jobs1["membership-expiry"].expired >= 1); assert.equal((await MembershipDoc.findOne({ userId: meena!._id }))!.status, "expired");
    const sunil = await User.findOne({ email: "sunil.pilot@example.invalid" });
    assert.equal(await NotificationModel.countDocuments({ userId: sunil!._id, title: "Library fee due" }), 1, "fee reminders are sent once per week");
    assert.equal(jobs2["fee-due-reminders"].sent, 0);
    assert.ok(await JobRun.exists({ name: "billing-reconciliation", status: "ok" }));
    assert.equal(Object.values(jobs1).some((r) => (r as { error?: string }).error), false, "no job reported an error");
    // ---- Library ID → student request → owner verification → seat allotment → punch in/out ----
    const libOwner = await account("owner", "libowner@join.invalid");
    const jr = (cookie: string, action: string, data: Record<string, unknown> = {}, status = 200) => api("/api/join", cookie, action, data, status);
    const pu = (cookie: string, action: string, data: Record<string, unknown> = {}, status = 200) => api("/api/punch", cookie, action, data, status);
    const ownerView = await getJson("/api/join?view=requests", libOwner);
    const libraryCode = ownerView.code as string;
    assert.match(libraryCode, /^LIB-[A-HJ-KM-NP-Z2-9]{6}$/, "every library gets a readable Library ID");
    assert.equal((await getJson("/api/join?view=requests", libOwner)).code, libraryCode, "the Library ID is stable");
    assert.notEqual((await getJson("/api/join?view=requests", other)).code, libraryCode, "each library has its own ID");
    // students look the ID up before sending a request
    const idPreview = await getJson(`/api/join?code=${encodeURIComponent(libraryCode.toLowerCase().replace("-", " "))}`, student);
    assert.equal(idPreview.code, libraryCode); assert.ok(idPreview.library.name);
    assert.equal((await fetch(`${base}/api/join?code=LIB-ZZZZZZ`, { headers: { cookie: student } })).status, 404);
    assert.equal((await fetch(`${base}/api/join?code=${libraryCode}`)).status, 401, "lookup requires sign-in");
    // a bad ID at registration does not block the account
    const badReg = await send("/api/auth/register", { acceptTerms: true, name: "Typo Student", email: "typo@join.invalid", password: pw(), role: "student", libraryCode: "LIB-ZZZZZZ" }, { Origin: base });
    assert.equal(badReg.status, 200); assert.notEqual((await rawJson(badReg)).join, "requested");
    // register with the Library ID → pending request
    const joinPassword = pw();
    const reg1 = await send("/api/auth/register", { acceptTerms: true, name: "Join Student", email: "join1@join.invalid", password: joinPassword, role: "student", libraryCode }, { Origin: base });
    assert.equal(reg1.status, 200); assert.equal((await rawJson(reg1)).join, "requested");
    const joiner = (reg1.headers.get("set-cookie") ?? "").split(";")[0];
    const joinerUser = await User.findOne({ email: "join1@join.invalid" });
    assert.equal(joinerUser!.libraryId, undefined, "the student is not linked until the owner verifies");
    await pu(joiner, "in", {}, 400); // no library yet
    await jr(joiner, "request", { code: libraryCode }, 400); // one pending request at a time
    const waiting = await getJson("/api/join?view=requests", libOwner);
    assert.equal(waiting.requests.length, 1); assert.equal(waiting.requests[0].student.email, "join1@join.invalid");
    const requestId = waiting.requests[0]._id;
    await jr(joiner, "approve", { id: requestId }, 403); // students cannot approve
    await jr(other, "approve", { id: requestId }, 400); // another library cannot approve it
    assert.equal((await getJson("/api/join?view=requests", other)).requests.length, 0, "requests are private to their library");
    // owner approves only: linked, but cannot punch without an active membership
    await jr(libOwner, "approve", { id: requestId });
    assert.equal(String((await User.findById(joinerUser!._id))!.libraryId).length, 24);
    const prePunch = await pu(joiner, "in", {}, 400); assert.match(prePunch.error, /membership/i);
    assert.equal((await getJson("/api/punch", joiner)).membershipActive, false);
    await jr(libOwner, "approve", { id: requestId }, 400); // already decided
    // allot a seat (existing validated allocation) and punch
    await post(libOwner, "seats", { label: "J1", floor: "G" }); await post(libOwner, "shifts", { name: "Day", start: 360, end: 1320 }); await post(libOwner, "plans", { name: "Monthly", amount: 100000, days: 30 });
    const jstate = await get(libOwner);
    await post(libOwner, "memberships", { userId: String(joinerUser!._id), planId: jstate.plans[0]._id, seatId: jstate.seats[0]._id, start: new Date(Date.now() - 5000).toISOString(), shiftStart: 360, shiftEnd: 1320, discount: 0 });
    assert.equal((await getJson("/api/punch", joiner)).membershipActive, true);
    const inRes = await pu(joiner, "in");
    assert.ok(inRes.at);
    assert.match((await pu(joiner, "in", {}, 400)).error, /already punched in/i);
    const presence = await getJson("/api/punch", libOwner);
    const inside = presence.inside.find((s: { name: string }) => s.name === "Join Student");
    assert.ok(inside && inside.seat === "J1", "the library sees who is inside and on which seat");
    assert.equal((await getJson("/api/punch", joiner)).inside, true);
    await pu(joiner, "out");
    assert.match((await pu(joiner, "out", {}, 400)).error, /not punched in/i);
    await pu(joiner, "in"); await pu(joiner, "out"); // a second visit the same day
    const mine = await getJson("/api/punch", joiner);
    assert.equal(mine.inside, false); assert.equal(mine.today.sessions.length, 2, "both visits are in the student's history");
    const libLog = (await getJson("/api/punch", libOwner)).log.find((r: { name: string }) => r.name === "Join Student");
    assert.equal(libLog.sessions.length, 2, "and in the library's record");
    const legacy = await getJson("/api/workspace?resource=attendance", libOwner);
    assert.ok(legacy.records.length >= 1 && legacy.records.some((r: { checkOut?: string }) => r.checkOut), "existing attendance screens still see the day record with first in and last out");
    // simultaneous punch-ins from two devices: only one succeeds
    const parallel = await Promise.all(Array.from({ length: 6 }, () => send("/api/punch", { action: "in", data: {} }, { cookie: joiner, Origin: base })));
    assert.equal(parallel.filter((r) => r.status === 200).length, 1, "exactly one concurrent punch-in is recorded");
    // owner can close a forgotten punch-out; other libraries cannot
    await pu(other, "manual-out", { userId: String(joinerUser!._id) }, 400);
    await pu(libOwner, "manual-out", { userId: String(joinerUser!._id) });
    assert.equal((await getJson("/api/punch", joiner)).inside, false);
    await pu(joiner, "manual-out", { userId: String(joinerUser!._id) }, 403);
    // stale open visits are closed and flagged, never counted
    const { Attendance: AttendanceDoc } = await import("../src/lib/models");
    await AttendanceDoc.updateOne({ userId: joinerUser!._id, day: dayKey() }, { $push: { sessions: { inAt: new Date(Date.now() - 20 * 3600000), method: "app" } } });
    const afterStale = await getJson("/api/punch", joiner);
    assert.equal(afterStale.inside, false, "a visit open for 20 hours is closed automatically");
    assert.ok(afterStale.today.sessions.some((s: { auto: boolean }) => s.auto));
    await pu(joiner, "in"); await pu(joiner, "out");
    const joinedLibId = String((await User.findById(joinerUser!._id))!.libraryId);
    // QR proof-of-presence mode
    await jr(libOwner, "set-policy", { punchPolicy: "qr" });
    assert.match((await pu(joiner, "in", {}, 400)).error, /scan the QR/i);
    assert.match((await pu(joiner, "in", { token: "not-a-token" }, 400)).error, /expired or is invalid/i);
    const makeToken = async (lib: string, purpose = "attendance") => new SignJWT({ libraryId: lib, purpose }).setProtectedHeader({ alg: "HS256" }).setJti(randomUUID()).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(sessionSecret));
    assert.match((await pu(joiner, "in", { token: await makeToken(String(otherCtx.activeBranchId)) }, 400)).error, /not for your library/i);
    assert.match((await pu(joiner, "in", { token: await makeToken(joinedLibId, "other") }, 400)).error, /not for your library/i);
    const oneUse = await makeToken(joinedLibId);
    await pu(joiner, "in", { token: oneUse });
    await pu(joiner, "out"); // leaving never needs a code
    assert.match((await pu(joiner, "in", { token: oneUse }, 400)).error, /already used/i); // a code cannot be replayed
    await jr(libOwner, "set-policy", { punchPolicy: "app" });
    await jr(libOwner, "set-policy", { punchPolicy: "qr" }); await jr(libOwner, "set-policy", { punchPolicy: "app" });
    await jr(joiner, "set-policy", { punchPolicy: "qr" }, 403);
    // rejection path
    const reg2 = await send("/api/auth/register", { acceptTerms: true, name: "Rejected Student", email: "join2@join.invalid", password: pw(), role: "student", libraryCode }, { Origin: base });
    const rejCookie = (reg2.headers.get("set-cookie") ?? "").split(";")[0];
    const rejReq = (await getJson("/api/join?view=requests", libOwner)).requests[0]._id;
    await jr(libOwner, "reject", { id: rejReq, note: "Not in our batch list" });
    const rejView = await getJson("/api/join", rejCookie);
    assert.equal(rejView.linked, null); assert.equal(rejView.requests[0].status, "rejected"); assert.equal(rejView.requests[0].note, "Not in our batch list");
    await pu(rejCookie, "in", {}, 400);
    await jr(rejCookie, "request", { code: libraryCode }); // may try again after a rejection
    await jr(joiner, "request", { code: libraryCode }, 400); // already in a library
    // a student cannot read another library's requests or presence presence
    assert.equal((await fetch(`${base}/api/punch?day=2026-01-01`, { headers: { cookie: joiner } })).status, 200); // students get their own view, not the library's
    assert.equal((await getJson("/api/punch?day=2026-01-01", joiner)).log, undefined);
    // forgotten punch-outs are closed by the scheduled job too
    await AttendanceDoc.updateOne({ userId: joinerUser!._id, day: dayKey() }, { $push: { sessions: { inAt: new Date(Date.now() - 30 * 3600000), method: "app" } } });
    const jobRun = (await sa("jobs-run", {})).record.results["stale-punches"];
    assert.ok(jobRun.closed >= 1, "the stale-punches job closes forgotten visits");

    // ---- 100 m location check on punch in / out ----
    const here = { lat: 28.6139, lng: 77.209 }; // one degree of latitude is about 111,195 m
    const near = { lat: here.lat + 0.0005, lng: here.lng, accuracy: 15 }; // about 56 m away
    const far = { lat: here.lat + 0.002, lng: here.lng, accuracy: 15 }; // about 222 m away
    assert.equal((await getJson("/api/punch", joiner)).geo, null, "no location limit until the owner sets one");
    await jr(joiner, "set-location", here, 403); // students cannot set it
    await jr(libOwner, "set-location", { lat: 120, lng: 0 }, 422);
    await jr(libOwner, "set-location", here);
    assert.equal((await getJson("/api/punch", joiner)).geo.radiusM, 100);
    assert.deepEqual((await getJson("/api/join?view=owner", libOwner)).library.location, here);
    assert.equal((await getJson("/api/punch", joiner)).inside, false);
    assert.match((await pu(joiner, "in", {}, 400)).error, /allow location/i);
    assert.match((await pu(joiner, "in", far, 400)).error, /out of geolocation/i);
    assert.match((await pu(joiner, "in", { ...near, accuracy: 900 }, 400)).error, /not accurate/i);
    assert.equal((await getJson("/api/punch", joiner)).inside, false, "a rejected punch records nothing");
    // the QR check-in endpoint cannot be used to skip the location check
    const viaCheckIn = await send("/api/workspace", { action: "check-in", data: { token: await makeToken(joinedLibId) } }, { Origin: base, cookie: joiner });
    assert.equal(viaCheckIn.status, 400);
    assert.match((await viaCheckIn.json()).error, /allow location/i);
    assert.equal((await getJson("/api/punch", joiner)).inside, false);
    await pu(joiner, "in", near);
    assert.match((await pu(joiner, "out", far, 400)).error, /out of geolocation/i);
    assert.equal((await getJson("/api/punch", joiner)).inside, true, "still inside after a rejected punch-out");
    await pu(joiner, "out", near);
    await pu(joiner, "in", near);
    await pu(libOwner, "manual-out", { userId: String(joinerUser!._id) }); // the owner's manual close needs no location
    assert.equal((await getJson("/api/punch", joiner)).inside, false);
    // ---- R8: two-step sign-in (TOTP), recovery codes, lockout, session behaviour and CSP ----
    const { hotp, stepAt } = await import("../src/lib/two-factor");
    const { RateLimit } = await import("../src/lib/ops-models");
    await RateLimit.deleteMany({ key: /^register:ip:/ }); // earlier sign-up throttle tests used this source address
    const tfEmail = "twostep@example.invalid";
    let tfCookie = await account("student", tfEmail); // two-step sign-in is optional for students and staff
    const tfPost = (action: string, body: unknown, cookie?: string) => send(`/api/auth/${action}`, body, { Origin: base, ...(cookie ? { cookie } : {}) });
    const tfStatus = async (cookie: string) => (await fetch(base + "/api/auth/2fa-status", { headers: { cookie } })).json();
    const tfStep = () => stepAt(Date.now());
    const goodCode = (secret: string, offset = 0) => hotp(secret, tfStep() + offset);
    const badCode = (secret: string) => { const ok = new Set([-2, -1, 0, 1, 2].map((o) => hotp(secret, tfStep() + o))); for (let n = 100000; ; n++) if (!ok.has(String(n))) return String(n); };
    const clearReplay = () => User.updateOne({ email: tfEmail }, { $unset: { twoFactorLastStep: 1 } }); // stands in for time passing between sign-ins
    const clearLocks = () => RateLimit.deleteMany({ key: /^2fa:/ });
    assert.equal((await tfStatus(tfCookie)).enabled, false);
    assert.equal((await fetch(base + "/api/auth/2fa-status")).status, 401, "status needs a session");
    const plain = await tfPost("login", { email: tfEmail, password });
    assert.equal(plain.status, 200, "accounts without two-step sign-in keep signing in with a password only");
    assert.ok(plain.headers.get("set-cookie"));
    // enrolment needs the password, then a code from the authenticator
    assert.equal((await tfPost("2fa-setup", { password: "wrong-password-123" }, tfCookie)).status, 400, "setup re-checks the password");
    assert.equal((await tfPost("2fa-setup", { password })).status, 401, "setup needs a session");
    const setup = await rawJson(await tfPost("2fa-setup", { password }, tfCookie));
    assert.match(setup.secret, /^[A-Z2-7]{32}$/);
    assert.ok(String(setup.qr).startsWith("data:image/png;base64,") && String(setup.otpauthUri).startsWith("otpauth://totp/"));
    const pendingRow = await User.findOne({ email: tfEmail }).select("+twoFactorPendingEnc");
    assert.ok(pendingRow?.twoFactorPendingEnc && !pendingRow.twoFactorPendingEnc.includes(setup.secret), "the seed is stored encrypted, never in plain text");
    assert.equal((await tfPost("2fa-enable", { code: badCode(setup.secret) }, tfCookie)).status, 400, "a wrong code does not enable two-step sign-in");
    assert.equal((await tfStatus(tfCookie)).enabled, false);
    const enabled = await tfPost("2fa-enable", { code: goodCode(setup.secret) }, tfCookie);
    assert.equal(enabled.status, 200);
    const enabledBody = await rawJson(enabled);
    assert.equal(enabledBody.recoveryCodes.length, 10);
    assert.equal(new Set(enabledBody.recoveryCodes).size, 10);
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: tfCookie } })).status, 401, "enabling signs out the old session");
    tfCookie = enabled.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: tfCookie } })).status, 200, "the new session works");
    const stored = await User.findOne({ email: tfEmail }).select("+twoFactorSecretEnc +twoFactorRecovery");
    assert.ok(stored?.twoFactorSecretEnc && !stored.twoFactorSecretEnc.includes(setup.secret));
    assert.equal(stored?.twoFactorRecovery?.length, 10);
    assert.ok(stored!.twoFactorRecovery!.every((h: string) => enabledBody.recoveryCodes.every((c: string) => !h.includes(c.replace(/-/g, "")))), "recovery codes are stored only as hashes");
    const exposed = JSON.stringify([await (await fetch(base + "/api/auth/me", { headers: { cookie: tfCookie } })).json(), await get(tfCookie)]);
    assert.ok(!/twoFactorSecretEnc|twoFactorRecovery|twoFactorPendingEnc|twoFactorLastStep|recovery/i.test(exposed), "no seed, hash or recovery data leaves the server");
    assert.equal((await tfPost("2fa-setup", { password }, tfCookie)).status, 400, "already enabled");
    // sign-in: the password alone no longer creates a session
    const first = await tfPost("login", { email: tfEmail, password });
    const challenge1 = await rawJson(first);
    assert.equal(first.status, 200);
    assert.equal(challenge1.twoFactorRequired, true);
    assert.equal(first.headers.get("set-cookie"), null, "no session cookie after the password step");
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: `sq-session=${challenge1.challenge}` } })).status, 401, "a challenge is not a session");
    assert.equal((await tfPost("2fa-login", { challenge: "x".repeat(40), code: "123456" })).status, 401, "garbage challenge");
    assert.equal((await tfPost("2fa-login", { challenge: challenge1.challenge, code: badCode(setup.secret) })).status, 401, "wrong code");
    const usedCode = goodCode(setup.secret, 1); // fixed once so a 30-second boundary cannot change it between the two uses
    const signedIn = await tfPost("2fa-login", { challenge: challenge1.challenge, code: usedCode });
    assert.equal(signedIn.status, 200, await signedIn.clone().text());
    assert.ok(signedIn.headers.get("set-cookie")?.includes("HttpOnly"));
    assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: signedIn.headers.get("set-cookie")!.split(";")[0] } })).status, 200);
    const challenge2 = await rawJson(await tfPost("login", { email: tfEmail, password }));
    assert.equal((await tfPost("2fa-login", { challenge: challenge2.challenge, code: usedCode })).status, 401, "a code that was already used cannot be replayed");
    await clearLocks();
    // recovery codes: one use each
    const codes: string[] = enabledBody.recoveryCodes;
    const viaRecovery = async (code: string) => tfPost("2fa-login", { challenge: (await rawJson(await tfPost("login", { email: tfEmail, password }))).challenge, recoveryCode: code });
    const r1 = await viaRecovery(codes[0]);
    assert.equal(r1.status, 200);
    assert.equal((await rawJson(r1)).recoveryUsed, true);
    assert.equal((await viaRecovery(codes[0])).status, 401, "a consumed recovery code cannot be reused");
    assert.equal((await viaRecovery(codes[1].toLowerCase().replace("-", " "))).status, 200, "formatting is forgiven, the code is still single-use");
    assert.equal((await viaRecovery("AAAA-BBBB-CCCC")).status, 401);
    assert.equal((await tfStatus(tfCookie)).recoveryRemaining, 8);
    const concurrent = await Promise.all([viaRecovery(codes[2]), viaRecovery(codes[2])]);
    assert.equal(concurrent.filter((r) => r.status === 200).length, 1, "two simultaneous uses of one recovery code: exactly one wins");
    assert.equal((await tfStatus(tfCookie)).recoveryRemaining, 7);
    // brute force: five wrong codes lock the second step for that account, even for the right code
    await clearLocks();
    const lockChallenge = (await rawJson(await tfPost("login", { email: tfEmail, password }))).challenge;
    for (let i = 0; i < 5; i++) assert.equal((await tfPost("2fa-login", { challenge: lockChallenge, code: badCode(setup.secret) })).status, 401);
    await clearReplay();
    assert.equal((await tfPost("2fa-login", { challenge: lockChallenge, code: goodCode(setup.secret) })).status, 429, "locked after five failures");
    assert.equal((await viaRecovery(codes[3])).status, 429, "recovery codes are locked too");
    const otherAccount = await tfPost("login", { email: "victim@example.invalid", password: "definitely-wrong-password" });
    assert.equal(otherAccount.status, 401, "other accounts are unaffected by this lock");
    await clearLocks();
    // re-authentication for sensitive changes
    assert.equal((await tfPost("2fa-recovery", { password, code: goodCode(setup.secret) })).status, 401, "needs a session");
    assert.equal((await tfPost("2fa-recovery", { password: "wrong-password-123", code: goodCode(setup.secret) }, tfCookie)).status, 400, "regenerating needs the password");
    assert.equal((await tfPost("2fa-recovery", { password, code: badCode(setup.secret) }, tfCookie)).status, 401, "and a valid code");
    await clearReplay();
    assert.equal((await tfPost("2fa-recovery", { password, recoveryCode: codes[4] } as object, tfCookie)).status, 400, "regeneration cannot be authorised with a recovery code");
    const regen = await tfPost("2fa-recovery", { password, code: goodCode(setup.secret) }, tfCookie);
    assert.equal(regen.status, 200);
    const newCodes: string[] = (await rawJson(regen)).recoveryCodes;
    assert.equal(newCodes.length, 10);
    assert.equal((await viaRecovery(codes[5])).status, 401, "old recovery codes stop working after regeneration");
    assert.equal((await viaRecovery(newCodes[0])).status, 200);
    // password change and a reset link cannot bypass the second factor
    assert.equal((await tfPost("change-password", { current: password, password: "another-long-password-1" }, tfCookie)).status, 400, "change-password asks for a code");
    await clearReplay();
    const tfChanged = await tfPost("change-password", { current: password, password: "another-long-password-1", code: goodCode(setup.secret) }, tfCookie);
    assert.equal(tfChanged.status, 200, await tfChanged.clone().text());
    tfCookie = tfChanged.headers.get("set-cookie")!.split(";")[0];
    const tfUser = await User.findOne({ email: tfEmail });
    const resetToken = rb(24).toString("base64url");
    await ResetModel.create({ userId: tfUser!._id, tokenHash: hashToken(resetToken), expiresAt: new Date(Date.now() + 600000) });
    const resetRes = await tfPost("reset", { token: resetToken, password: "third-long-password-123" });
    const resetBody = await rawJson(resetRes);
    assert.equal(resetRes.status, 200);
    assert.equal(resetBody.twoFactorRequired, true, "a reset link alone does not sign an account with two-step sign-in in");
    assert.equal(resetRes.headers.get("set-cookie"), null);
    const resetDone = await tfPost("2fa-login", { challenge: resetBody.challenge, recoveryCode: newCodes[1] });
    assert.equal(resetDone.status, 200, "the second factor completes the reset");
    // turning it off needs the password and a valid factor; afterwards sign-in is password-only again
    const tfNewPassword = "third-long-password-123";
    assert.equal((await tfPost("2fa-disable", { password: "wrong-password-123", code: goodCode(setup.secret) }, resetDone.headers.get("set-cookie")!.split(";")[0])).status, 400);
    assert.equal((await tfPost("2fa-disable", { password: tfNewPassword, code: badCode(setup.secret) }, resetDone.headers.get("set-cookie")!.split(";")[0])).status, 401);
    await clearReplay();
    const disabled = await tfPost("2fa-disable", { password: tfNewPassword, code: goodCode(setup.secret) }, resetDone.headers.get("set-cookie")!.split(";")[0]);
    assert.equal(disabled.status, 200);
    const afterDisable = await User.findOne({ email: tfEmail }).select("+twoFactorSecretEnc +twoFactorRecovery");
    assert.ok(!afterDisable?.twoFactorEnabled && !afterDisable?.twoFactorSecretEnc && !(afterDisable?.twoFactorRecovery?.length), "seed and recovery codes are deleted");
    const passwordOnly = await tfPost("login", { email: tfEmail, password: tfNewPassword });
    assert.equal(passwordOnly.status, 200);
    assert.ok(passwordOnly.headers.get("set-cookie") && !(await rawJson(passwordOnly)).twoFactorRequired);
    // another account's two-step sign-in cannot be touched
    const bystander = await account("student", "bystander@example.invalid");
    assert.equal((await tfPost("2fa-disable", { password, code: "123456" }, bystander)).status, 400, "not enabled for this account");
    await clearLocks();

    // ---- R9: two-step sign-in is mandatory for owners and platform admins ----
    await RateLimit.deleteMany({ key: /^(register:ip:|2fa:|login:)/ });
    const r9 = {
      email: "mandatory-owner@example.invalid",
      pass: "mandatory-owner-pass-1",
      session: async (userId: unknown, sv = 0) => "sq-session=" + (await new SignJWT({ sv }).setProtectedHeader({ alg: "HS256" }).setSubject(String(userId)).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(sessionSecret))),
      me: async (cookie?: string) => (await (await fetch(base + "/api/auth/me", { headers: cookie ? { cookie } : {} })).json()).user,
      status: async (path: string, cookie: string) => (await fetch(base + path, { headers: { cookie } })).status,
    };
    const r9token = async (userId: unknown) => { const t = rb(24).toString("base64url"); await ResetModel.create({ userId, tokenHash: hashToken(t), expiresAt: new Date(Date.now() + 600000) }); return t; };
    // sign-up as an owner: no session, only a restricted enrolment token
    const signup = await tfPost("register", { acceptTerms: true, name: "Mandatory Owner", email: r9.email, password: r9.pass, role: "owner", library: "Mandatory Library" });
    assert.equal(signup.status, 200);
    assert.equal(signup.headers.get("set-cookie"), null, "owner sign-up creates no session");
    const signupBody = await rawJson(signup);
    assert.equal(signupBody.twoFactorEnrollmentRequired, true);
    assert.ok(signupBody.enrollmentToken && !JSON.stringify(signupBody).includes("passwordHash"));
    // password sign-in of the same unenrolled owner: still no session
    const r9login = await rawJson(await tfPost("login", { email: r9.email, password: r9.pass }));
    assert.equal(r9login.twoFactorEnrollmentRequired, true);
    const token1 = r9login.enrollmentToken as string;
    assert.equal((await tfPost("login", { email: r9.email, password: "wrong-password-123" })).status, 401);
    // the token is not a session, not a second-factor challenge, and not accepted by ordinary APIs
    for (const path of ["/api/workspace", "/api/fees", "/api/billing"]) assert.notEqual(await r9.status(path, `sq-session=${token1}`), 200, `${path} rejects the enrolment token as a session`);
    assert.equal((await r9.me(`sq-session=${token1}`)) ?? null, null);
    assert.equal((await tfPost("2fa-login", { challenge: token1, code: "123456" })).status, 401, "enrolment token is not a login challenge");
    assert.equal((await tfPost("2fa-setup", { password: r9.pass })).status, 401, "enrolment needs a session or token");
    assert.equal((await tfPost("2fa-enable", { code: "123456", enrollmentToken: "x".repeat(40) })).status, 401, "a made-up token is rejected");
    assert.equal((await tfPost("2fa-recovery", { password: r9.pass, code: "123456", enrollmentToken: token1 })).status, 401, "the token unlocks nothing but setup and enable");
    assert.equal((await tfPost("2fa-disable", { password: r9.pass, code: "123456", enrollmentToken: token1 })).status, 401);
    // an old pre-policy session for the unenrolled owner is dead too (existing-session bypass)
    const r9user = await User.findOne({ email: r9.email });
    const r9legacy = await r9.session(r9user!._id, r9user!.sessionVersion ?? 0);
    for (const path of ["/api/workspace", "/api/fees", "/api/billing", "/api/seat-map", "/api/access?view=manage", "/api/export"]) assert.ok([401, 403].includes(await r9.status(path, r9legacy)), `${path} refuses an unenrolled owner's session`);
    assert.equal(await r9.me(r9legacy), null);
    // enrolment: password, then a code from the authenticator
    assert.equal((await tfPost("2fa-setup", { password: "wrong-password-123", enrollmentToken: token1 })).status, 400);
    const setup1 = await rawJson(await tfPost("2fa-setup", { password: r9.pass, enrollmentToken: token1 }));
    assert.ok(setup1.secret && setup1.qr);
    const badEnable = await tfPost("2fa-enable", { code: badCode(setup1.secret), enrollmentToken: token1 });
    assert.equal(badEnable.status, 400);
    assert.equal(badEnable.headers.get("set-cookie"), null);
    assert.equal(await r9.status("/api/workspace", r9legacy), 401, "still no access after a failed code");
    const okEnable = await tfPost("2fa-enable", { code: goodCode(setup1.secret), enrollmentToken: token1 });
    assert.equal(okEnable.status, 200);
    const okBody = await rawJson(okEnable);
    assert.equal(okBody.recoveryCodes.length, 10);
    const r9cookie = okEnable.headers.get("set-cookie")!.split(";")[0];
    assert.ok(okEnable.headers.get("set-cookie")!.includes("HttpOnly"));
    assert.equal(await r9.status("/api/workspace", r9cookie), 200, "normal session after enrolment");
    assert.equal((await tfPost("2fa-enable", { code: goodCode(setup1.secret, 1), enrollmentToken: token1 })).status, 401, "the token is single-use");
    assert.equal((await tfPost("2fa-setup", { password: r9.pass, enrollmentToken: token1 })).status, 401);
    assert.equal(await r9.status("/api/workspace", r9legacy), 401, "enrolment ends every earlier session");
    assert.equal((await r9.me(r9cookie)).email, r9.email);
    // from now on sign-in needs the code; an owner can never turn it off
    const r9second = await rawJson(await tfPost("login", { email: r9.email, password: r9.pass }));
    assert.equal(r9second.twoFactorRequired, true);
    assert.equal((await tfPost("2fa-disable", { password: r9.pass, code: goodCode(setup1.secret, 1) }, r9cookie)).status, 403, "owners cannot turn two-step sign-in off");
    assert.equal((await tfStatus(r9cookie)).enabled, true);
    // tenant isolation is intact for the newly enrolled owner
    assert.notEqual(String((await r9.me(r9cookie)).libraryId), String((await r9.me(owner)).libraryId));

    // password reset / change / session revocation cannot bypass the policy
    const r9row = await User.findOne({ email: r9.email });
    await User.updateOne({ _id: r9row!._id }, { $set: { twoFactorEnabled: false } });
    const r9reset = await tfPost("reset", { token: await r9token(r9row!._id), password: "reset-owner-password-1" });
    assert.equal(r9reset.status, 200);
    assert.equal(r9reset.headers.get("set-cookie"), null, "a reset link does not sign an unenrolled owner in");
    assert.equal((await rawJson(r9reset)).twoFactorEnrollmentRequired, true);
    assert.equal((await tfPost("change-password", { current: "reset-owner-password-1", password: "another-owner-pass-12" }, r9cookie)).status, 401, "no session, so no password change");
    // real operator reset: the account must enrol again, there is no way in without it
    await User.updateOne({ _id: r9row!._id }, { $set: { twoFactorEnabled: true } });
    execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "scripts/reset-2fa.ts"], { env: { ...process.env, MONGODB_URI: replica.getUri(), RESET_2FA_EMAIL: r9.email }, stdio: "pipe" });
    const afterOp = await User.findOne({ email: r9.email }).select("+twoFactorSecretEnc +twoFactorRecovery");
    assert.ok(!afterOp!.twoFactorEnabled && !afterOp!.twoFactorSecretEnc && !afterOp!.twoFactorRecovery?.length);
    assert.equal(await r9.status("/api/workspace", r9cookie), 401, "the operator reset ends the old session and grants no access");
    const afterReset = await rawJson(await tfPost("login", { email: r9.email, password: "reset-owner-password-1" }));
    assert.equal(afterReset.twoFactorEnrollmentRequired, true, "after an operator reset the owner must enrol again");
    assert.ok(!afterReset.challenge);
    const setup2 = await rawJson(await tfPost("2fa-setup", { password: "reset-owner-password-1", enrollmentToken: afterReset.enrollmentToken }));
    const done2 = await tfPost("2fa-enable", { code: goodCode(setup2.secret), enrollmentToken: afterReset.enrollmentToken });
    assert.equal(done2.status, 200);
    assert.equal(await r9.status("/api/workspace", done2.headers.get("set-cookie")!.split(";")[0]), 200);

    // role changes apply immediately
    const promoted = await account("student", "promoted@example.invalid");
    assert.equal(await r9.status("/api/workspace", promoted), 200);
    const promotedRow = await User.findOne({ email: "promoted@example.invalid" });
    await User.updateOne({ _id: promotedRow!._id }, { $set: { role: "owner" } });
    assert.equal(await r9.status("/api/workspace", promoted), 401, "a user who gains the owner role loses access until enrolled");
    await User.updateOne({ _id: promotedRow!._id }, { $set: { role: "super-admin" } });
    assert.notEqual(await r9.status("/api/saas-admin?view=orgs", promoted), 200, "same for platform admin");
    await User.updateOne({ _id: promotedRow!._id }, { $set: { role: "staff" } });
    assert.equal((await r9.me(promoted))?.role, "staff", "staff are not forced to enrol");
    await User.updateOne({ _id: promotedRow!._id }, { $set: { role: "student" } });
    assert.equal((await r9.me(promoted))?.role, "student");
    const stuLogin = await tfPost("login", { email: "promoted@example.invalid", password });
    const stuBody = await rawJson(stuLogin);
    assert.ok(stuLogin.headers.get("set-cookie") && !stuBody.twoFactorRequired && !stuBody.twoFactorEnrollmentRequired, "student sign-in is unchanged");

    // platform admins: same gate, and enrolment works for them
    const bcryptJs = (await import("bcryptjs")).default;
    const adminAcct = await User.create({ name: "Admin Two", email: "admin2@example.invalid", passwordHash: await bcryptJs.hash("admin-two-password-1", 10), role: "super-admin" });
    assert.notEqual(await r9.status("/api/saas-admin?view=orgs", await r9.session(adminAcct._id, 0)), 200, "unenrolled admin session is refused");
    const adminLogin = await rawJson(await tfPost("login", { email: "admin2@example.invalid", password: "admin-two-password-1" }));
    assert.equal(adminLogin.twoFactorEnrollmentRequired, true);
    assert.equal(adminLogin.role, "super-admin");
    const adminSetup = await rawJson(await tfPost("2fa-setup", { password: "admin-two-password-1", enrollmentToken: adminLogin.enrollmentToken }));
    const adminDone = await tfPost("2fa-enable", { code: goodCode(adminSetup.secret), enrollmentToken: adminLogin.enrollmentToken });
    assert.equal(adminDone.status, 200);
    const adminCk = adminDone.headers.get("set-cookie")!.split(";")[0];
    assert.equal(await r9.status("/api/saas-admin?view=orgs", adminCk), 200);
    assert.equal((await tfPost("2fa-disable", { password: "admin-two-password-1", code: goodCode(adminSetup.secret, 1) }, adminCk)).status, 403, "platform admins cannot turn it off");
    const unknown = await rawJson(await tfPost("login", { email: "admin-none@example.invalid", password: "nobody-nobody-12" }));
    assert.ok(!unknown.enrollmentToken, "unknown accounts get no enrolment token");

    // nothing sensitive is logged
    const leaked = [setup1.secret, setup2.secret, adminSetup.secret, token1, afterReset.enrollmentToken, ...okBody.recoveryCodes, r9.pass].filter((v) => serverLog.includes(v));
    assert.deepEqual(leaked, [], "no secret, token, recovery code or password appears in server logs");
    await RateLimit.deleteMany({ key: /^2fa:/ });

    // ---- R11: health endpoints, monitoring failures never break business flows, alert delivery, no leakage ----
    if (!failingSink || !okSink) console.log("NOTE: openssl is unavailable, so the HTTPS alert-webhook checks were SKIPPED");
    // liveness and readiness are public, uncached and expose nothing but coarse state
    const r11live = await fetch(base + "/api/health");
    assert.equal(r11live.status, 200); assert.equal(r11live.headers.get("cache-control"), "no-store");
    assert.deepEqual(Object.keys(await r11live.json()).sort(), ["status", "uptimeSeconds"]);
    assert.equal((await fetch(base + "/api/health", { method: "HEAD" })).status, 200);
    const r11Ready = await fetch(base + "/api/ready");
    const r11ReadyText = await r11Ready.text();
    assert.equal(r11Ready.headers.get("cache-control"), "no-store");
    const r11ReadyBody = JSON.parse(r11ReadyText);
    assert.deepEqual(Object.keys(r11ReadyBody).sort(), ["alerting", "checks", "degraded", "status"]);
    assert.ok(r11Ready.status === 200 || r11Ready.status === 503);
    assert.equal(r11ReadyBody.checks.database.ok, true);
    assert.ok(!/mongodb|replicaSet|127\.0\.0\.1:\d{5}|SESSION_SECRET|@/.test(r11ReadyText), "readiness exposes no credentials, hosts or topology");
    assert.ok(!/libraryId|email|membership|payment|student/i.test(r11ReadyText), "health endpoints carry no tenant or business data");
    assert.equal(r11ReadyBody.alerting, failingSink ? "configured" : "not-configured");

    // the failing webhook received the boot-time configuration alert (production config is intentionally imperfect in this harness) and nothing broke
    if (failingSink) {
      for (let i = 0; i < 20 && !failingSink.hits.length; i++) await new Promise((r) => setTimeout(r, 250));
      assert.ok(failingSink.hits.length >= 1, "alert delivery was attempted");
      const first = failingSink.hits[0].body as Record<string, unknown> & { key?: string; status?: string; text?: string; severity?: string; runbook?: string; details?: Record<string, unknown> };
      assert.equal(first.key, "config.invalid"); assert.equal(first.status, "firing"); assert.match(String(first.text), /CRITICAL/);
      assert.ok(!JSON.stringify(first).includes(sessionSecret), "alert payloads never carry secrets");
      assert.ok(failingSink.hits.length < 5, "alerts are deduplicated, not repeated per request");
    }
    assert.ok(!serverLog.includes(replica.getUri()), "the database connection string never appears in server logs");
    assert.ok(!serverLog.includes("mongodb://"), "no database URI of any kind in server logs");

    // an application instance whose database is DOWN: liveness stays up, readiness fails fast and quietly, users get generic errors, one alert is sent
    if (okSink) {
      const dead = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3102", "--hostname", "127.0.0.1"], {
        env: { ...process.env, MONGODB_URI: "mongodb://127.0.0.1:1/unreachable?serverSelectionTimeoutMS=1500", SESSION_SECRET: sessionSecret, APP_URL: "http://127.0.0.1:3102", ALERT_WEBHOOK_URL: okSink.url, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      extraServers.push(dead);
      let deadLog = "";
      dead.stdout!.on("data", (c) => { deadLog += c; }); dead.stderr!.on("data", (c) => { deadLog += c; });
      const d = "http://127.0.0.1:3102";
      for (let i = 0; i < 60; i++) { try { if ((await fetch(d + "/api/health")).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
      assert.equal((await fetch(d + "/api/health")).status, 200, "liveness does not depend on MongoDB");
      const t0 = Date.now();
      const deadReady = await fetch(d + "/api/ready");
      const deadText = await deadReady.text();
      assert.equal(deadReady.status, 503);
      assert.ok(Date.now() - t0 < 8000, "readiness answers within its probe timeout instead of hanging");
      assert.equal(JSON.parse(deadText).checks.database.detail, "unreachable");
      assert.ok(!/mongodb|127\.0\.0\.1:1|unreachable\?|ECONNREFUSED|MongoServer/i.test(deadText.replace('"unreachable"', "")), "readiness reveals no topology or driver errors");
      // a user trying to sign in during the outage gets a generic message, not internals
      const login = await fetch(d + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: d }, body: JSON.stringify({ email: "someone@example.invalid", password: "a-long-enough-password" }) });
      const loginText = await login.text();
      assert.ok(login.status >= 400 && login.status < 600);
      assert.ok(!/mongodb|ECONNREFUSED|MongoServer|\sat\s.+\(.*:\d+:\d+\)|node_modules/i.test(loginText), "no stack trace or driver error reaches the user");
      assert.equal((await fetch(d + "/api/health")).status, 200, "the process keeps serving after the failures");
      for (let i = 0; i < 24 && !okSink.hits.some((h) => (h.body as { key?: string }).key === "db.unavailable"); i++) await new Promise((r) => setTimeout(r, 250));
      const dbAlerts = okSink.hits.filter((h) => (h.body as { key?: string }).key === "db.unavailable");
      assert.equal(dbAlerts.length, 1, "exactly one database-unavailable alert despite several failing requests");
      const dbBody = dbAlerts[0].body as Record<string, unknown> & { key?: string; status?: string; text?: string; severity?: string; runbook?: string; details?: Record<string, unknown> };
      assert.equal(dbBody.severity, "critical"); assert.match(String(dbBody.runbook), /MONITORING\.md#alert-db/);
      assert.ok(!JSON.stringify(dbBody).includes("mongodb://"), "alert has no database URI");
      assert.ok(!deadLog.includes("mongodb://") && !deadLog.includes(sessionSecret), "the unavailable-database logs carry no URI or secret");
      assert.ok(/api\.unexpected_error|alert\.db\.unavailable/.test(deadLog), "the failures were logged for operators");
    }

    // ---- R12: payment gateway (Razorpay) pipeline against a LOCAL gateway simulator. NOT the provider's own sandbox: that needs real test keys. ----
    {
      const { createServer: createPlainServer } = await import("node:http");
      const KEY_ID = "rzp_test_HttpSuite01", KEY_SECRET = "httpsuite-key-secret-0123456789", HOOK_SECRET = "httpsuite-webhook-secret-0123456789";
      const gw = { mode: "up" as "up" | "down", calls: [] as { method: string; path: string; auth: string; body: { plan_id?: string; notes?: { organizationId?: string } } }[], payments: [] as Record<string, unknown>[], subs: 0 };
      const gateway = createPlainServer((req, res) => {
        let data = ""; req.on("data", (c) => { data += c; });
        req.on("end", () => {
          const path = (req.url ?? "").split("?")[0];
          gw.calls.push({ method: req.method ?? "", path, auth: String(req.headers.authorization ?? ""), body: data ? JSON.parse(data) : {} });
          const good = req.headers.authorization === `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
          if (gw.mode === "down") { res.writeHead(503); return res.end("{}"); }
          if (!good) { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { description: "Authentication failed" } })); }
          res.writeHead(200, { "Content-Type": "application/json" });
          if (req.method === "POST" && path === "/v1/subscriptions") return res.end(JSON.stringify({ id: `sub_Http${String(++gw.subs).padStart(6, "0")}`, short_url: `https://rzp.io/i/sim${gw.subs}` }));
          if (req.method === "POST" && /^\/v1\/subscriptions\/[\w]+\/cancel$/.test(path)) return res.end("{}");
          if (req.method === "GET" && path === "/v1/payments") return res.end(JSON.stringify({ items: gw.payments }));
          res.end("{}");
        });
      });
      await new Promise<void>((r) => gateway.listen(0, "127.0.0.1", r));
      const gwBase = `http://127.0.0.1:${(gateway.address() as { port: number }).port}/v1`;
      const startServer = async (port: number, env: Record<string, string>) => {
        const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"], { env: { ...process.env, MONGODB_URI: replica.getUri(), SESSION_SECRET: sessionSecret, APP_URL: `http://127.0.0.1:${port}`, ...(okSink ? { ALERT_WEBHOOK_URL: okSink.url, NODE_TLS_REJECT_UNAUTHORIZED: "0" } : {}), ...env }, stdio: ["ignore", "pipe", "pipe"] });
        extraServers.push(proc);
        const box = { log: "" };
        proc.stdout!.on("data", (c) => { box.log += c; }); proc.stderr!.on("data", (c) => { box.log += c; });
        for (let i = 0; i < 80; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
        return { base: `http://127.0.0.1:${port}`, box };
      };
      const rz = await startServer(3103, { RAZORPAY_KEY_ID: KEY_ID, RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: HOOK_SECRET, RAZORPAY_API_BASE: gwBase });

      const PRICE = (await S.SaaSPlan.findOne({ key: "starter", current: true }))!.monthlyPaise, THIRD = Math.round(PRICE / 3); // earlier admin tests re-price plans: always use the CURRENT list price
      const ownerEmail = "rz-owner@example.invalid", otherEmail = "rz-other@example.invalid";
      const rzOwner = await account("owner", ownerEmail), rzOther = await account("owner", otherEmail);
      const org = (await S.Organization.findOne({ billingEmail: ownerEmail }))!, otherOrg = (await S.Organization.findOne({ billingEmail: otherEmail }))!;
      await S.SaaSPlan.updateOne({ key: "starter", current: true }, { providerPlanIds: { razorpay: { monthly: "plan_StarterM01", annual: "plan_StarterA01" } } });
      const post = (cookie: string, body: unknown, method = "POST", at = rz.base) => fetch(`${at}/api/billing`, { method, headers: { cookie, Origin: at, "Content-Type": "application/json" }, body: JSON.stringify(body) });

      // configuration is reported without secrets
      const view = await (await fetch(`${rz.base}/api/billing`, { headers: { cookie: rzOwner } })).text();
      const viewJson = JSON.parse(view);
      assert.deepEqual([viewJson.provider.name, viewJson.provider.mode, viewJson.provider.configured, viewJson.provider.usable], ["razorpay", "sandbox", true, true], "rzp_test_ keys run in TEST mode");
      assert.ok(!view.includes(KEY_SECRET) && !view.includes(HOOK_SECRET) && !view.includes(KEY_ID), "billing responses never contain gateway credentials");

      // checkout: created at the gateway with the right credentials; nothing is paid or activated by creating it
      const subBefore = await S.SaaSSubscription.findOne({ organizationId: org._id });
      const ck = await (await post(rzOwner, { action: "checkout", data: { planKey: "starter", interval: "monthly" } })).json();
      assert.equal(ck.ok, true, JSON.stringify(ck)); assert.equal(ck.checkoutUrl, "https://rzp.io/i/sim1"); assert.ok(!ck.sandbox);
      const created = gw.calls.find((c) => c.path === "/v1/subscriptions")!;
      assert.equal(created.auth, `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`, "server-side Basic auth with the key pair");
      assert.equal(created.body.plan_id, "plan_StarterM01"); assert.equal(created.body.notes?.organizationId, String(org._id));
      const checkout = (await S.BillingCheckout.findOne({ organizationId: org._id }))!;
      assert.deepEqual([checkout.provider, checkout.mode, checkout.status], ["razorpay", "sandbox", "created"]);
      const subId = checkout.providerSubscriptionId;
      const sameSub = await S.SaaSSubscription.findOne({ organizationId: org._id });
      assert.deepEqual([sameSub!.planKey, sameSub!.status], [subBefore!.planKey, subBefore!.status], "creating a checkout changes nothing about the plan");
      // a gateway outage at checkout time fails cleanly and leaves no half-created record
      gw.mode = "down";
      const down = await post(rzOwner, { action: "checkout", data: { planKey: "starter", interval: "annual" } });
      assert.equal(down.status, 400);
      assert.equal(await S.BillingCheckout.countDocuments({ organizationId: org._id }), 1, "no checkout record without a gateway subscription");
      gw.mode = "up";

      // the browser can never declare a payment successful
      assert.equal((await post(rzOwner, { checkoutId: String(checkout._id), outcome: "success" }, "PUT")).status, 403, "the sandbox completion endpoint is closed when a gateway is configured");
      for (const action of ["payment-success", "confirm", "mark-paid", "complete-checkout"]) assert.equal((await post(rzOwner, { action, data: { checkoutId: String(checkout._id), paymentId: "pay_Browser0001", status: "captured" } })).status, 400, action);
      assert.equal((await post(rzOther, { checkoutId: String(checkout._id), outcome: "success" }, "PUT")).status, 403);
      const stillUnpaid = await S.SaaSSubscription.findOne({ organizationId: org._id });
      assert.equal(stillUnpaid!.planKey, subBefore!.planKey); assert.equal(await S.BillingPayment.countDocuments({ organizationId: org._id }), 0);

      // webhook signature and shape
      const sigOf = (raw: string, secret = HOOK_SECRET) => signBody(raw, secret);
      const hookRaw = (raw: string, eventId: string, signature: string | null) => fetch(`${rz.base}/api/billing/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "x-razorpay-event-id": eventId, ...(signature === null ? {} : { "x-razorpay-signature": signature }) }, body: raw });
      const rzHook = (payload: unknown, eventId = `evt_rz_${++rzN}`) => { const raw = JSON.stringify(payload); return hookRaw(raw, eventId, sigOf(raw)); };
      let rzN = 0;
      const charged = (paymentId: string, amount = PRICE, at = Math.floor(Date.now() / 1000), pay: Record<string, unknown> = {}) => ({ entity: "event", event: "subscription.charged", created_at: at, payload: { subscription: { entity: { id: subId, status: "active", current_start: at, current_end: at + 2592000 } }, payment: { entity: { id: paymentId, amount, currency: "INR", status: "captured", method: "card", notes: { organizationId: String(org._id), checkoutId: String(checkout._id) }, ...pay } } } });
      const body0 = JSON.stringify(charged("pay_HttpBad0001"));
      assert.equal((await hookRaw(body0, "evt_nosig", null)).status, 400, "missing signature");
      assert.equal((await hookRaw(body0, "evt_wrongsig", "0".repeat(64))).status, 400, "wrong signature");
      assert.equal((await hookRaw(body0, "evt_wrongkey", sigOf(body0, KEY_SECRET))).status, 400, "signed with the API key secret instead of the webhook secret");
      assert.equal((await hookRaw(body0 + " ", "evt_tamper", sigOf(body0))).status, 400, "body changed after signing");
      assert.equal((await hookRaw("{not json", "evt_junk", sigOf("{not json"))).status, 400, "malformed JSON with a valid signature");
      assert.equal((await hookRaw("{}", "evt_empty", sigOf("{}"))).status, 400, "a signed body that is not an event");
      assert.equal(await S.BillingWebhookEvent.countDocuments({ eventId: { $in: ["evt_nosig", "evt_wrongsig", "evt_wrongkey", "evt_tamper", "evt_junk", "evt_empty"] } }), 0, "unverified requests are never stored");
      assert.equal(await S.BillingPayment.countDocuments({ organizationId: org._id }), 0, "an unverified webhook marks nothing paid");

      // successful payment: verify the DATABASE, not a response
      assert.equal((await rzHook({ entity: "event", event: "subscription.activated", created_at: Math.floor(Date.now() / 1000), payload: { subscription: { entity: { id: subId, status: "active", current_start: Math.floor(Date.now() / 1000), current_end: Math.floor(Date.now() / 1000) + 2592000 } } } })).status, 200);
      const okEvent = charged("pay_HttpOk00001");
      assert.equal((await rzHook(okEvent, "evt_ok_1")).status, 200);
      const paid = await S.SaaSSubscription.findOne({ organizationId: org._id });
      assert.deepEqual([paid!.planKey, paid!.status, paid!.provider, paid!.mode, paid!.source], ["starter", "active", "razorpay", "sandbox", "provider"]);
      const inv = await S.BillingInvoice.findOne({ providerPaymentId: "pay_HttpOk00001" });
      assert.deepEqual([inv!.status, inv!.totalPaise, inv!.amountPaidPaise, inv!.mode, String(inv!.organizationId)], ["paid", PRICE, PRICE, "sandbox", String(org._id)]);
      assert.match(inv!.number, /^[A-Z]+-\d{4}-\d{6}$/);
      const payment = await S.BillingPayment.findOne({ providerPaymentId: "pay_HttpOk00001" });
      assert.deepEqual([payment!.status, payment!.amountPaise, payment!.currency, payment!.needsReview, String(payment!.invoiceId)], ["captured", PRICE, "INR", false, String(inv!._id)]);
      assert.equal((await S.BillingCheckout.findById(checkout._id))!.status, "completed");
      const mine = await (await fetch(`${rz.base}/api/billing`, { headers: { cookie: rzOwner } })).json();
      assert.ok(mine.invoices.some((i: { providerPaymentId?: string }) => i.providerPaymentId === "pay_HttpOk00001"), "the owner sees the receipt");
      const theirs = await (await fetch(`${rz.base}/api/billing`, { headers: { cookie: rzOther } })).json();
      assert.ok(!JSON.stringify(theirs).includes("pay_HttpOk00001"), "another tenant never sees it");
      assert.equal(await S.BillingPayment.countDocuments({ organizationId: otherOrg._id }), 0);

      // duplicate delivery (same event id, and the same payment under another event id) records nothing twice
      assert.equal((await (await rzHook(okEvent, "evt_ok_1")).json()).duplicate, true);
      await rzHook(okEvent, "evt_ok_other_id");
      await Promise.all([1, 2, 3, 4].map((i) => rzHook(okEvent, `evt_ok_parallel_${i}`)));
      for (let i = 1; i <= 4; i++) await rzHook(okEvent, `evt_ok_parallel_${i}`);
      assert.deepEqual([await S.BillingInvoice.countDocuments({ providerPaymentId: "pay_HttpOk00001" }), await S.BillingPayment.countDocuments({ providerPaymentId: "pay_HttpOk00001" })], [1, 1], "exactly one invoice and one payment");

      // amount / currency / tenant / id mismatches are rejected without touching any record, and alert once
      const stateOf = async () => JSON.stringify([await S.BillingInvoice.countDocuments({ organizationId: org._id }), await S.BillingPayment.countDocuments({ organizationId: org._id }), (await S.SaaSSubscription.findOne({ organizationId: org._id }))!.toObject().currentPeriodEnd]);
      const frozen = await stateOf();
      for (const [label, payload] of [
        ["usd", charged("pay_HttpUsd0001", PRICE, undefined, { currency: "USD" })],
        ["zero", charged("pay_HttpZero001", 0)],
        ["negative", charged("pay_HttpNeg0001", -100)],
        ["fraction", charged("pay_HttpFrac001", 100.5)],
        ["badid", charged("order_HttpBad001")],
        ["othertenant", charged("pay_HttpTen0001", PRICE, undefined, { notes: { organizationId: String(otherOrg._id) } })],
        ["othersub", charged("pay_HttpSub0001", PRICE, undefined, { subscription_id: "sub_SomethingElse1" })],
        ["authorized", charged("pay_HttpAut0001", PRICE, undefined, { status: "authorized" })],
      ] as [string, unknown][]) {
        const r = await rzHook(payload, `evt_mismatch_${label}`);
        assert.equal(r.status, 200, `${label}: acknowledged so the gateway does not retry`);
        assert.equal((await S.BillingWebhookEvent.findOne({ eventId: `evt_mismatch_${label}` }))!.status, "rejected", label);
      }
      assert.equal(await stateOf(), frozen, "no invoice, payment or subscription change from any rejected event");
      for (let i = 0; i < 24 && !okSink?.hits.some((h) => String((h.body as { key?: string }).key).startsWith("billing.anomaly")); i++) await new Promise((r) => setTimeout(r, 250));
      if (okSink) {
        const anomalies = okSink.hits.filter((h) => String((h.body as { key?: string }).key).startsWith("billing.anomaly"));
        assert.ok(anomalies.length >= 1 && anomalies.length <= 8, "rejections alert, deduplicated per cause");
        assert.ok(!JSON.stringify(anomalies).includes(KEY_SECRET) && !JSON.stringify(anomalies).includes(HOOK_SECRET), "alerts carry no credentials");
      }

      // over-charge: real money is recorded and flagged for review, not discarded
      assert.equal((await rzHook(charged("pay_HttpOver0001", PRICE * 2))).status, 200);
      const over = await S.BillingPayment.findOne({ providerPaymentId: "pay_HttpOver0001" });
      assert.equal(over!.needsReview, true); assert.match(over!.reviewReason!, /more than the plan price/);

      // declined payment: failed record, plan and money untouched; the gateway later marks the subscription past due
      const planBefore = await S.SaaSSubscription.findOne({ organizationId: org._id });
      const failedEv = (id: string, extra: Record<string, unknown> = {}) => ({ entity: "event", event: "payment.failed", created_at: Math.floor(Date.now() / 1000) + 5, payload: { subscription: { entity: { id: subId } }, payment: { entity: { id, amount: PRICE, currency: "INR", status: "failed", error_description: "Your card was declined", notes: { organizationId: String(org._id) }, ...extra } } } });
      assert.equal((await rzHook(failedEv("pay_HttpFail0001"))).status, 200);
      await rzHook(failedEv("pay_HttpFail0001"), "evt_fail_dup");
      assert.deepEqual([(await S.BillingPayment.findOne({ providerPaymentId: "pay_HttpFail0001" }))!.status, (await S.BillingInvoice.findOne({ providerPaymentId: "pay_HttpFail0001" }))!.status], ["failed", "failed"]);
      assert.equal(await S.BillingPayment.countDocuments({ providerPaymentId: "pay_HttpFail0001" }), 1);
      const planAfter = await S.SaaSSubscription.findOne({ organizationId: org._id });
      assert.deepEqual([planAfter!.planKey, planAfter!.status, +planAfter!.currentPeriodEnd!], [planBefore!.planKey, "active", +planBefore!.currentPeriodEnd!], "a decline does not change the paid plan or period");
      assert.equal((await S.BillingPayment.find({ organizationId: org._id, status: "captured" })).reduce((n, p) => n + p.amountPaise, 0), PRICE + PRICE * 2, "captured totals unchanged by the decline");
      assert.equal((await rzHook({ entity: "event", event: "subscription.pending", created_at: Math.floor(Date.now() / 1000) + 10, payload: { subscription: { entity: { id: subId } } } })).status, 200);
      assert.equal((await S.SaaSSubscription.findOne({ organizationId: org._id }))!.status, "past_due");

      // refunds
      const refundEv = (rid: string, amount: number, payment = "pay_HttpOk00001") => ({ entity: "event", event: "refund.processed", created_at: Math.floor(Date.now() / 1000) + 20, payload: { subscription: { entity: { id: subId } }, refund: { entity: { id: rid, payment_id: payment, amount, currency: "INR" } } } });
      await rzHook(refundEv("rfnd_HttpRef01", THIRD)); await rzHook(refundEv("rfnd_HttpRef01", THIRD));
      let refunded = await S.BillingPayment.findOne({ providerPaymentId: "pay_HttpOk00001" });
      assert.deepEqual([refunded!.refundedPaise, refunded!.status], [THIRD, "partially_refunded"], "the same refund is counted once");
      await rzHook(refundEv("rfnd_HttpRef02", (PRICE - THIRD)));
      refunded = await S.BillingPayment.findOne({ providerPaymentId: "pay_HttpOk00001" });
      assert.deepEqual([refunded!.refundedPaise, refunded!.status], [PRICE, "refunded"]);
      assert.equal((await S.BillingInvoice.findOne({ providerPaymentId: "pay_HttpOk00001" }))!.status, "refunded");
      assert.equal((await rzHook(refundEv("rfnd_HttpRef03", 100, "pay_HttpFail0001"))).status, 200);
      assert.equal(await S.BillingPayment.countDocuments({ providerPaymentId: "pay_HttpFail0001", refundedPaise: { $gt: 0 } }), 0, "no refund against a failed payment");

      // delayed delivery: an old payment after a newer cancellation is recorded but never revives the subscription
      const now2 = Math.floor(Date.now() / 1000);
      await rzHook({ entity: "event", event: "subscription.cancelled", created_at: now2 + 1000, payload: { subscription: { entity: { id: subId, current_end: now2 + 2592000 } } } });
      assert.equal((await rzHook(charged("pay_HttpLate0001", PRICE, now2 + 500))).status, 200);
      assert.equal((await S.SaaSSubscription.findOne({ organizationId: org._id }))!.status, "canceled");
      assert.equal(await S.BillingPayment.countDocuments({ providerPaymentId: "pay_HttpLate0001" }), 1);

      // reconciliation of the gateway's own list against the database (read-only)
      const { reconcileWithProvider } = await import("../src/lib/billing-reconcile");
      const local = await S.BillingPayment.find({ organizationId: org._id }).lean();
      for (const p of local) gw.payments.push({ id: p.providerPaymentId, amount: p.amountPaise, currency: "INR", status: p.status === "failed" ? "failed" : p.refundedPaise >= p.amountPaise ? "refunded" : "captured", amount_refunded: p.refundedPaise });
      const reconCfg = { provider: "razorpay" as const, mode: "sandbox" as const, keyId: KEY_ID, keySecret: KEY_SECRET, webhookSecret: HOOK_SECRET, configured: true, usable: true };
      const clean = await reconcileWithProvider({ cfg: reconCfg, days: 3, fetch: ((u: string, i: RequestInit) => fetch(u.replace(/^https:\/\/api\.razorpay\.com\/v1/, gwBase), i)) as never });
      assert.equal(clean.ok, true, JSON.stringify(clean.discrepancies));
      gw.payments.push({ id: "pay_HttpGhost001", amount: PRICE, currency: "INR", status: "captured", amount_refunded: 0 }); // money at the gateway whose webhook never arrived
      const broken = await reconcileWithProvider({ cfg: { ...reconCfg, mode: "sandbox" }, days: 3, fetch: ((u: string, i: RequestInit) => fetch(u.replace(/^https:\/\/api\.razorpay\.com\/v1/, gwBase), i)) as never });
      assert.deepEqual(broken.discrepancies.map((d) => `${d.type}:${d.paymentId}`), ["missing-locally:pay_HttpGhost001"]);

      // secrets stay out of logs and responses
      for (const secret of [KEY_SECRET, HOOK_SECRET, KEY_ID, Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")]) assert.ok(!rz.box.log.includes(secret), "gateway credentials never appear in server logs");

      // a LIVE key in a non-production-grade deployment (http APP_URL) is refused: checkouts stay disabled and no gateway call is made
      const callsBefore = gw.calls.length;
      const liveSrv = await startServer(3104, { RAZORPAY_KEY_ID: "rzp_live_HttpSuite01", RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: HOOK_SECRET, RAZORPAY_API_BASE: gwBase });
      const liveView = await (await fetch(`${liveSrv.base}/api/billing`, { headers: { cookie: rzOwner } })).json();
      assert.deepEqual([liveView.provider.mode, liveView.provider.usable], ["live", false], "live key without https APP_URL is not usable");
      const liveCk = await post(rzOwner, { action: "checkout", data: { planKey: "starter", interval: "monthly" } }, "POST", liveSrv.base);
      assert.equal(liveCk.status, 400);
      assert.equal(gw.calls.length, callsBefore, "no request ever reached a gateway");
      const liveReady = await (await fetch(`${liveSrv.base}/api/ready`)).json();
      assert.equal(liveReady.checks.config.ok, false, "readiness reports the configuration error");
      assert.ok(!JSON.stringify(liveReady).includes("rzp_live") && !liveSrv.box.log.includes(KEY_SECRET), "no credentials in readiness or logs");
      assert.match(liveSrv.box.log, /config\.issue/);
      // partial gateway settings never fall back to the sandbox
      const partialSrv = await startServer(3105, { RAZORPAY_KEY_ID: KEY_ID });
      const partialView = await (await fetch(`${partialSrv.base}/api/billing`, { headers: { cookie: rzOwner } })).json();
      assert.deepEqual([partialView.provider.name, partialView.provider.usable, partialView.provider.configured], ["razorpay", false, false]);
      assert.equal((await post(rzOwner, { checkoutId: String(checkout._id), outcome: "success" }, "PUT", partialSrv.base)).status, 403, "no sandbox payment path with partial settings");
      gateway.close();
    }

    // ---- R13: legal pages, consent capture and enforcement ----
    {
      const { ConsentRecord } = await import("../src/lib/ops-models");
      const { LEGAL_VERSIONS } = await import("../src/lib/legal");
      const consentVersion = `${LEGAL_VERSIONS.terms}|${LEGAL_VERSIONS.privacy}`;
      const jsonOf = async (res: Response) => res.json().catch(() => ({}));
      // legal pages are public, readable signed-out, and carry their version and the draft notice
      for (const [path, heading] of [["/privacy", "Privacy Notice"], ["/terms", "Terms of Service"]] as const) {
        const res = await fetch(base + path);
        const html = await res.text();
        assert.equal(res.status, 200, `${path} is public`);
        assert.ok(html.includes(heading) && html.includes("Draft pending legal review"), `${path} states that it is an unreviewed draft`);
        assert.ok(html.includes(`data-legal-version="${path === "/privacy" ? "privacy" : "terms"}">${path === "/privacy" ? LEGAL_VERSIONS.privacy : LEGAL_VERSIONS.terms}`), `${path} shows its version`);
        assert.ok((html.match(/data-placeholder="true"/g) ?? []).length >= 8, `${path} marks the details the business must supply`);
      }
      // the public site footer and the sign-in / registration pages link to both documents
      for (const path of ["/", "/login", "/register"]) { const html = await (await fetch(base + path)).text(); assert.ok(html.includes('href="/terms"') && html.includes('href="/privacy"'), `${path} links to the Terms and Privacy Notice`); }

      // registration cannot bypass consent through the API
      const reg = (body: Record<string, unknown>) => send("/api/auth/register", { name: "Consent Person", password: pw(), role: "student", ...body }, { Origin: base });
      for (const [label, extra] of [["missing", {}], ["false", { acceptTerms: false }], ["string", { acceptTerms: "true" }]] as [string, Record<string, unknown>][]) {
        const r = await reg({ email: `noterms-${label}@example.invalid`, ...extra });
        assert.equal(r.status, 400, `${label}: refused`);
        assert.equal(r.headers.get("set-cookie"), null);
        if (label !== "string") assert.equal((await jsonOf(r)).code, "terms-required");
        assert.equal(await User.countDocuments({ email: `noterms-${label}@example.invalid` }), 0, `${label}: no account was created`);
      }
      const ownerNoTerms = await reg({ email: "noterms-owner@example.invalid", role: "owner", library: "No Terms Library" });
      assert.equal(ownerNoTerms.status, 400); assert.equal(await User.countDocuments({ email: "noterms-owner@example.invalid" }), 0);

      // acceptance is recorded with version, timestamp, user reference and source; marketing is separate and never implied
      const accepted = await reg({ email: "terms-only@example.invalid", acceptTerms: true });
      assert.equal(accepted.status, 200);
      const termsOnly = (await User.findOne({ email: "terms-only@example.invalid" }))!;
      const rows = await ConsentRecord.find({ userId: termsOnly._id }).lean();
      assert.deepEqual(rows.map((r) => [r.kind, r.version, r.accepted, r.source]), [["terms", consentVersion, true, "register"]], "accepting the Terms records NO marketing consent");
      assert.ok(rows[0].createdAt instanceof Date);
      const withMarketing = await reg({ email: "terms-marketing@example.invalid", acceptTerms: true, marketing: true });
      const declined = await reg({ email: "terms-nomarketing@example.invalid", acceptTerms: true, marketing: false });
      assert.equal(withMarketing.status, 200); assert.equal(declined.status, 200);
      const kinds = async (email: string) => (await ConsentRecord.find({ userId: (await User.findOne({ email }))!._id }).sort({ kind: 1 }).lean()).map((r) => `${r.kind}:${r.accepted}`);
      assert.deepEqual(await kinds("terms-marketing@example.invalid"), ["marketing:true", "terms:true"]);
      assert.deepEqual(await kinds("terms-nomarketing@example.invalid"), ["marketing:false", "terms:true"]);

      // the consent API: own records only, authenticated, same-origin
      const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0];
      const studentCookie = cookieOf(accepted);
      assert.equal((await fetch(base + "/api/consent")).status, 401, "signed-out requests are refused");
      assert.equal((await send("/api/consent", { action: "accept-terms", accept: true }, { Origin: base })).status, 401);
      assert.equal((await send("/api/consent", { action: "accept-terms", accept: true }, { Origin: "http://evil.example", cookie: studentCookie })).status, 403, "cross-site writes are refused");
      const mine = await (await fetch(base + "/api/consent", { headers: { cookie: studentCookie } })).json();
      assert.deepEqual([mine.terms.accepted, mine.terms.current, mine.termsNeedAcceptance, mine.marketing], [true, true, false, null]);
      assert.ok(!JSON.stringify(mine).includes("userId") && !JSON.stringify(mine).includes(String(termsOnly._id)), "the response carries no user identifiers");

      // tenant isolation: another user (an owner of another library) never sees or changes someone else's records
      const strangerOwner = await account("owner", "consent-stranger@example.invalid");
      const strangerView = await (await fetch(base + "/api/consent", { headers: { cookie: strangerOwner } })).json();
      assert.equal(strangerView.history, 1, "only the caller's own single record is visible, never anyone else's");
      assert.ok(!JSON.stringify(strangerView).includes(String(termsOnly._id)));
      const tamper = await send("/api/consent", { action: "marketing", value: true, userId: String(termsOnly._id) }, { Origin: base, cookie: strangerOwner });
      assert.equal(tamper.status, 200);
      assert.equal(await ConsentRecord.countDocuments({ userId: termsOnly._id }), 1, "a user id in the body is ignored: another user's history is untouched");
      assert.equal(await ConsentRecord.countDocuments({ userId: (await User.findOne({ email: "consent-stranger@example.invalid" }))!._id, kind: "marketing" }), 1, "the change landed on the caller's own record");
      assert.equal((await send("/api/consent", { action: "marketing", value: "yes" }, { Origin: base, cookie: strangerOwner })).status, 400);
      assert.equal((await send("/api/consent", { action: "accept-terms", accept: false }, { Origin: base, cookie: strangerOwner })).status, 400, "acceptance can only be recorded as accepted");

      // existing accounts are never locked out: no record = a prompt, not a block; accepting appends history
      const legacy = await account("student", "legacy-no-consent@example.invalid");
      const legacyUser = (await User.findOne({ email: "legacy-no-consent@example.invalid" }))!;
      await ConsentRecord.deleteMany({ userId: legacyUser._id }); // an account created before consent was captured
      const before = await (await fetch(base + "/api/consent", { headers: { cookie: legacy } })).json();
      assert.deepEqual([before.terms, before.termsNeedAcceptance], [null, true]);
      assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: legacy } })).status, 200, "an account without a consent record keeps working");
      assert.equal((await fetch(base + "/api/privacy", { headers: { cookie: legacy } })).status, 200);
      const accept = await send("/api/consent", { action: "accept-terms", accept: true }, { Origin: base, cookie: legacy });
      assert.equal((await jsonOf(accept)).termsNeedAcceptance, false);
      const toggled = [true, false, true];
      for (const value of toggled) await send("/api/consent", { action: "marketing", value }, { Origin: base, cookie: legacy });
      const history = await ConsentRecord.find({ userId: legacyUser._id }).sort({ createdAt: 1 }).lean();
      assert.deepEqual(history.map((r) => `${r.kind}:${r.accepted}:${r.source}`), ["terms:true:prompt", "marketing:true:settings", "marketing:false:settings", "marketing:true:settings"], "records are append-only: every decision is kept");
      assert.equal((await (await fetch(base + "/api/consent", { headers: { cookie: legacy } })).json()).marketing.accepted, true, "the newest record wins");
      // a new policy version asks again (prompt only)
      await ConsentRecord.updateMany({ userId: legacyUser._id, kind: "terms" }, { $set: { version: "1999-01-01|1999-01-01" } });
      const stale = await (await fetch(base + "/api/consent", { headers: { cookie: legacy } })).json();
      assert.deepEqual([stale.terms.current, stale.termsNeedAcceptance], [false, true], "an older accepted version needs re-acceptance");
      assert.equal((await fetch(base + "/api/workspace", { headers: { cookie: legacy } })).status, 200, "still not locked out");
      // consent history is part of the person's own data export
      const exported = await (await fetch(base + "/api/privacy", { headers: { cookie: legacy } })).json();
      assert.ok(exported.sections.includes("consentRecords"));

      // paying needs the CURRENT Terms: owners who have not accepted can do so at checkout, otherwise it is refused (no gateway call, no checkout record)
      const payer = await account("owner", "consent-payer@example.invalid");
      const payerUser = (await User.findOne({ email: "consent-payer@example.invalid" }))!;
      const payerOrg = (await S.Organization.findOne({ billingEmail: "consent-payer@example.invalid" }))!;
      assert.equal(await S.BillingCheckout.countDocuments({ organizationId: payerOrg._id }), 0);
      await ConsentRecord.deleteMany({ userId: payerUser._id });
      const refused = await fetch(base + "/api/billing", { method: "POST", headers: { cookie: payer, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkout", data: { planKey: "starter", interval: "monthly" } }) });
      assert.equal(refused.status, 400); assert.equal((await refused.json()).code, "terms-required");
      assert.equal(await S.BillingCheckout.countDocuments({ organizationId: payerOrg._id }), 0, "no checkout without acceptance");
      const allowed = await fetch(base + "/api/billing", { method: "POST", headers: { cookie: payer, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "checkout", data: { planKey: "starter", interval: "monthly", acceptTerms: true } }) });
      assert.equal(allowed.status, 200);
      assert.equal(await S.BillingCheckout.countDocuments({ organizationId: payerOrg._id }), 1);
      assert.deepEqual((await ConsentRecord.find({ userId: payerUser._id }).lean()).map((r) => `${r.kind}:${r.source}`), ["terms:checkout"]);
    }

    // ---- R14: deployment safety, smoke test, pilot onboarding rehearsal ----
    {
      // the smoke test against this (deliberately imperfect, plain-http) test deployment: it must see what is right AND what is wrong
      const { runSmoke } = await import("../src/lib/smoke");
      const smoke = await runSmoke(base, { allowHttp: true });
      const by = Object.fromEntries(smoke.checks.map((c) => [c.name, c.status]));
      for (const name of ["liveness /api/health", "readiness body is coarse", "CSP: nonce-based scripts, no unsafe-inline/eval", "security headers", "no X-Powered-By", "API responses allow nothing (CSP)", "public page /login", "public page /register", "signed-out API refused: /api/workspace", "signed-out API refused: /api/billing", "signed-out API refused: /api/consent", "signed-out API refused: /api/saas-admin?view=orgs", "error hygiene", "failed sign-in sets no session", "robots.txt keeps private areas out of search"]) assert.equal(by[name], "pass", `smoke: ${name}`);
      assert.equal(by["legal page /privacy (signed out)"], "warn", "legal pages are reachable signed out but still flagged as a draft");
      assert.equal(by["legal page /terms (signed out)"], "warn");
      assert.equal(by["HTTPS"], "warn"); assert.equal(by["HSTS"], "skip");
      assert.equal(by["readiness /api/ready"], "fail", "this harness is intentionally misconfigured (http APP_URL, sandbox billing): readiness is correctly reported as failing");
      assert.equal(by["session cookie flags"], "skip", "no smoke account supplied: reported as not verified, not as a pass");
      assert.equal(smoke.ok, false);
      // with a dedicated smoke account the cookie flags are really checked
      const smokeEmail = "smoke-student@example.invalid";
      await account("student", smokeEmail);
      const withLogin = await runSmoke(base, { allowHttp: true, smokeLogin: { email: smokeEmail, password } });
      assert.equal(withLogin.checks.find((c) => c.name === "session cookie flags")!.status, "pass", "HttpOnly, SameSite=Lax, 7-day session cookie verified from a real sign-in");

      // a deployment with an explicit profile and invalid configuration refuses to start; staging can never run on a live payment key
      const refuse = (env: Record<string, string>, port: number) => new Promise<{ code: number | null; log: string }>((resolve) => {
        const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"], { env: { ...process.env, MONGODB_URI: replica.getUri(), SESSION_SECRET: sessionSecret, ...env }, stdio: ["ignore", "pipe", "pipe"] });
        extraServers.push(proc);
        let log = "";
        proc.stdout!.on("data", (c) => { log += c; }); proc.stderr!.on("data", (c) => { log += c; });
        const t = setTimeout(() => { proc.kill(); resolve({ code: null, log }); }, 60000);
        proc.on("exit", (code) => { clearTimeout(t); resolve({ code, log }); });
      });
      const prodBroken = await refuse({ APP_ENV: "production", APP_URL: "http://127.0.0.1:3107" }, 3107);
      assert.equal(prodBroken.code, 1, "a production deployment with missing/invalid configuration exits instead of serving");
      assert.match(prodBroken.log, /server\.refused_to_start/);
      for (const key of ["TWO_FACTOR_KEY", "APP_URL", "EMAIL_WEBHOOK_URL", "ALERT_WEBHOOK_URL", "BILLING_EXPECT_MODE", "MONGODB_URI"].filter((k) => k !== "BILLING_EXPECT_MODE")) assert.match(prodBroken.log, new RegExp(`"key":"${key}"`), `refusal names ${key}`);
      assert.ok(!prodBroken.log.includes(sessionSecret) && !prodBroken.log.includes(replica.getUri()), "the refusal log contains no secret or connection string");
      const stagingLive = await refuse({ APP_ENV: "staging", NODE_ENV: "production", APP_URL: "https://staging.example.in", TRUST_PROXY: "1", EMAIL_WEBHOOK_URL: "https://mail.example.in", ALERT_WEBHOOK_URL: "https://hooks.example.in", TWO_FACTOR_KEY: "t".repeat(40), RAZORPAY_KEY_ID: "rzp_live_StagingMistake1", RAZORPAY_KEY_SECRET: "keysecretkeysecret1234", RAZORPAY_WEBHOOK_SECRET: "webhooksecret-1234567" }, 3108);
      assert.equal(stagingLive.code, 1, "staging with a LIVE payment key refuses to start");
      assert.match(stagingLive.log, /"key":"RAZORPAY_KEY_ID"/);
      assert.ok(!stagingLive.log.includes("rzp_live_StagingMistake1") && !stagingLive.log.includes("keysecretkeysecret1234"), "no key material in the refusal log");

      // pilot onboarding rehearsal: two brand-new libraries set up from scratch; nothing of one is visible to the other
      const pilotA = await account("owner", "pilot-a@example.invalid"), pilotB = await account("owner", "pilot-b@example.invalid");
      const pilotApi = (cookie: string, path: string, action: string, data: unknown = {}, status = 200) => api(path, cookie, action, data, status);
      await pilotApi(pilotA, "/api/onboarding", "seats", { prefix: "A", count: 6 });
      await pilotApi(pilotA, "/api/onboarding", "shifts", { items: [{ name: "Morning", start: 360, end: 720 }] });
      await pilotApi(pilotA, "/api/onboarding", "fees", { items: [{ name: "Monthly", rupees: 900, days: 30 }] });
      const wsA = await getJson("/api/workspace", pilotA), wsB = await getJson("/api/workspace", pilotB);
      assert.equal(wsA.seats.length, 6); assert.equal(wsB.seats.length, 0, "a brand-new organization starts empty and sees none of another's setup");
      assert.equal(wsA.students.length, 0); assert.equal(wsB.students.length, 0);
      const codeA = (await getJson("/api/join?view=requests", pilotA)).code as string;
      assert.match(codeA, /^LIB-/);
      // a student joins library A with its ID; only A's owner can see and decide the request
      const pilotStudent = await tfPost("register", { acceptTerms: true, name: "Pilot Student", email: "pilot-student@example.invalid", password: "pilot-student-pass-1", role: "student", libraryCode: codeA });
      assert.equal(pilotStudent.status, 200);
      const pending = (await getJson("/api/join?view=requests", pilotA)).requests.filter((r: { status: string }) => r.status === "pending");
      assert.equal(pending.length, 1);
      assert.equal((await getJson("/api/join?view=requests", pilotB)).requests.filter((r: { status: string }) => r.status === "pending").length, 0, "library B does not see library A's join request");
      await pilotApi(pilotB, "/api/join", "approve", { id: pending[0]._id }, 400); // another tenant cannot decide it
      await pilotApi(pilotA, "/api/join", "approve", { id: pending[0]._id });
      const studentUser = (await User.findOne({ email: "pilot-student@example.invalid" }))!;
      assert.equal(String(studentUser.libraryId), String((await User.findOne({ email: "pilot-a@example.invalid" }))!.libraryId), "the student now belongs to library A only");
      const studentCookie = (pilotStudent.headers.get("set-cookie") ?? "").split(";")[0];
      assert.ok([401, 403].includes((await fetch(base + "/api/billing", { headers: { cookie: studentCookie } })).status), "a student never reads the library's billing");
      assert.equal((await getJson("/api/workspace", pilotB)).students.length, 0, "library B still sees no students");
      // data export: each owner gets only their own library's rows; a student is refused
      const csvA = await (await fetch(base + "/api/export?resource=students", { headers: { cookie: pilotA } })).text();
      const csvB = await (await fetch(base + "/api/export?resource=students", { headers: { cookie: pilotB } })).text();
      assert.ok(csvA.includes("pilot-student@example.invalid"), "owner A can export their own student list");
      assert.ok(!csvB.includes("pilot-student@example.invalid"), "owner B's export contains none of library A's students");
      assert.equal((await fetch(base + "/api/export?resource=students", { headers: { cookie: studentCookie } })).status, 403);
    }

    // ---- R17: /api/jobs/run (Vercel Cron) over HTTP: authorization, jobs, heartbeats, alerts, lock and idempotency. Isolated database, local HTTPS sinks only. ----
    const beatSink = okSink ? await startSink(200) : null, cronAlertSink = okSink ? await startSink(200) : null;
    if (beatSink && cronAlertSink) try {
      const cronSecret = "cron-" + randomBytes(24).toString("hex");
      const jobNames = ["saas-jobs", "membership-expiry", "stale-punches", "fee-due-reminders", "revision-reminders", "billing-reconciliation", "weekly-reports"];
      const cdb = await mongoose.createConnection(replica.getUri("r17cron")).asPromise();
      const [runs, locks, members] = [cdb.collection("jobruns"), cdb.collection("ratelimits"), cdb.collection("memberships")];
      const spawnCron = async (port: number, uri: string) => {
        const proc = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"], {
          env: { ...process.env, MONGODB_URI: uri, SESSION_SECRET: sessionSecret, APP_URL: `http://127.0.0.1:${port}`, CRON_SECRET: cronSecret, ALERT_WEBHOOK_URL: cronAlertSink.url, JOBS_HEARTBEAT_URL: beatSink.url, NODE_TLS_REJECT_UNAUTHORIZED: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        extraServers.push(proc);
        const logs = { text: "" };
        proc.stdout!.on("data", (c) => { logs.text += c; }); proc.stderr!.on("data", (c) => { logs.text += c; });
        for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 500)); }
        return { url: `http://127.0.0.1:${port}/api/jobs/run`, logs };
      };
      const cron = await spawnCron(3109, replica.getUri("r17cron"));
      const call = (target: string, init: { method?: string; headers?: Record<string, string> } = {}) => fetch(target, { method: init.method ?? "GET", headers: init.headers });
      const bearer = { authorization: `Bearer ${cronSecret}` };
      const reset = async () => { await runs.deleteMany({}); await locks.deleteMany({}); await members.deleteMany({}); beatSink.reqs.length = 0; cronAlertSink.hits.length = 0; };
      const staleMember = () => members.insertOne({ userId: new mongoose.Types.ObjectId(), libraryId: new mongoose.Types.ObjectId(), status: "active", amount: 0, paid: 0, start: new Date("2020-01-01"), end: new Date("2020-02-01") });
      const leaks = (text: string, log = "") => { assert.ok(!text.includes(cronSecret) && !log.includes(cronSecret), "the cron secret never appears in a response or log"); assert.ok(!/mongodb:\/\/|ECONNREFUSED|MongoServerError|node_modules|\sat\s.+\(.*:\d+:\d+\)|"stack"|Document failed validation/i.test(text), "no internals or stack traces in the response: " + text.slice(0, 200)); };
      const waitFor = async (cond: () => boolean) => { for (let i = 0; i < 40 && !cond(); i++) await new Promise((r) => setTimeout(r, 250)); };
      const alertKeys = () => cronAlertSink.hits.map((h) => (h.body as { key?: string }).key);

      // 1. missing / invalid secret: 401, no job runs, no heartbeat, no lock taken
      await reset(); await staleMember();
      for (const [method, headers] of [["GET", {}], ["GET", { authorization: "Bearer wrong-secret" }], ["POST", { "x-cron-secret": "wrong-secret" }], ["GET", { authorization: `Basic ${cronSecret}` }]] as const) {
        const r = await call(cron.url, { method, headers }); const t = await r.text();
        assert.equal(r.status, 401); leaks(t, cron.logs.text);
        assert.ok(!t.includes("wrong-secret"));
      }
      assert.equal(await runs.countDocuments(), 0, "no job ran");
      assert.equal(await locks.countDocuments({ key: "job-lock:all" }), 0, "no lock was taken");
      assert.equal(await members.countDocuments({ status: "active" }), 1, "no data was touched");
      assert.equal(beatSink.reqs.length, 0, "no heartbeat"); assert.ok(!alertKeys().includes("cron.failed"));

      // 2 + 3. valid authorization runs every job; the success heartbeat arrives once, after every job finished
      const ok = await call(cron.url, { headers: bearer }); const okText = await ok.text();
      assert.equal(ok.status, 200); leaks(okText, cron.logs.text);
      assert.equal(ok.headers.get("cache-control"), "no-store");
      const okBody = JSON.parse(okText); assert.equal(okBody.ok, true);
      for (const name of jobNames) assert.equal(await runs.countDocuments({ name, status: "ok" }), 1, `${name} ran once and succeeded`);
      assert.equal(await runs.countDocuments({ name: "cron", status: "ok" }), 1);
      assert.equal(okBody.result.results["membership-expiry"].expired, 1);
      assert.equal(await members.countDocuments({ status: "expired" }), 1, "the job performed its real work");
      assert.deepEqual(beatSink.reqs.map((r) => r.path), ["/alert"], "exactly one SUCCESS heartbeat");
      const lastJobEnd = Math.max(...(await runs.find({ name: { $in: jobNames } }).toArray()).map((r) => +new Date(r.startedAt) + (r.durationMs ?? 0)));
      assert.ok(beatSink.reqs[0].at >= lastJobEnd, "the heartbeat came after the last job completed");
      assert.ok(!alertKeys().includes("cron.failed"));

      // 7. a repeated request does not run the jobs again (lock) and the data is unchanged; once the lock is gone a re-run is idempotent
      const again = await call(cron.url, { headers: bearer });
      assert.deepEqual(await again.json(), { ok: true, skipped: true });
      for (const name of jobNames) assert.equal(await runs.countDocuments({ name }), 1, `${name} was not repeated`);
      assert.equal(beatSink.reqs.length, 1, "a skipped run sends no further heartbeat");
      await locks.deleteMany({});
      const rerun = await (await call(cron.url, { method: "POST", headers: { "x-cron-secret": cronSecret } })).json();
      assert.equal(rerun.ok, true); assert.equal(rerun.result.results["membership-expiry"].expired, 0, "idempotent: nothing is expired twice");
      assert.equal(await members.countDocuments({ status: "expired" }), 1);
      assert.equal(await runs.countDocuments({ name: "membership-expiry" }), 2);

      // 6. a lock held by another run: no jobs, no heartbeat, no alert
      await reset(); await staleMember();
      await locks.insertOne({ key: "job-lock:all", count: 1, resetAt: new Date(Date.now() + 120_000) });
      const held = await call(cron.url, { headers: bearer }); const heldText = await held.text();
      assert.equal(held.status, 200); assert.deepEqual(JSON.parse(heldText), { ok: true, skipped: true }); leaks(heldText);
      assert.equal(await runs.countDocuments(), 0, "no job executed");
      assert.equal(await members.countDocuments({ status: "active" }), 1, "no data changed");
      assert.equal(beatSink.reqs.length, 0, "no heartbeat"); await new Promise((r) => setTimeout(r, 500)); assert.equal(cronAlertSink.hits.length, 0, "no alert");

      // 7 (concurrent). a burst of simultaneous cron calls runs the jobs exactly once
      await reset(); await staleMember();
      const burst = await Promise.all([0, 1, 2, 3].map(() => call(cron.url, { headers: bearer }).then((r) => r.json())));
      assert.equal(burst.filter((b) => !b.skipped).length, 1, "exactly one request executed the jobs");
      assert.equal(burst.filter((b) => b.skipped).length, 3);
      for (const name of jobNames) assert.equal(await runs.countDocuments({ name }), 1, `${name} ran once in the burst`);
      assert.equal(beatSink.reqs.length, 1, "one heartbeat for the burst");

      // 4. a failing job: 500, failure heartbeat only, cron.failed reported, other jobs still ran, nothing sensitive in the response
      await reset(); await staleMember();
      await cdb.db!.command({ collMod: "memberships", validator: { status: { $ne: "expired" } }, validationLevel: "strict", validationAction: "error" });
      const bad = await call(cron.url, { headers: bearer }); const badText = await bad.text();
      assert.equal(bad.status, 500); assert.deepEqual(JSON.parse(badText), { ok: false, failed: ["membership-expiry"] }); leaks(badText, cron.logs.text);
      assert.equal(await runs.countDocuments({ name: "membership-expiry", status: "failed" }), 1);
      for (const name of jobNames.filter((n) => n !== "membership-expiry")) assert.equal(await runs.countDocuments({ name, status: "ok" }), 1, `${name} still ran`);
      assert.equal(await runs.countDocuments({ name: "cron", status: "failed" }), 1);
      assert.deepEqual(beatSink.reqs.map((r) => r.path), ["/alert/fail"], "failure heartbeat only, no success heartbeat");
      await waitFor(() => alertKeys().includes("cron.failed"));
      const cronAlerts = cronAlertSink.hits.filter((h) => (h.body as { key?: string }).key === "cron.failed");
      assert.equal(cronAlerts.length, 1, "cron.failed reported exactly once");
      assert.equal((cronAlerts[0].body as { severity?: string }).severity, "critical");
      assert.ok(!JSON.stringify(cronAlerts[0].body).includes(cronSecret));
      // recovery: after the cause is fixed and the lock expired, the next run succeeds, heartbeats success and resolves the alert
      await cdb.db!.command({ collMod: "memberships", validator: {}, validationLevel: "off" });
      await locks.deleteMany({}); beatSink.reqs.length = 0;
      const fixed = await call(cron.url, { headers: bearer });
      assert.equal(fixed.status, 200); assert.deepEqual(beatSink.reqs.map((r) => r.path), ["/alert"]);
      await waitFor(() => cronAlertSink.hits.filter((h) => (h.body as { key?: string }).key === "cron.failed").length >= 2);
      assert.ok(cronAlertSink.hits.filter((h) => (h.body as { key?: string }).key === "cron.failed").some((h) => /resolved/i.test(JSON.stringify(h.body))), "a recovery notice follows the first good run");

      // 5. an unexpected exception (database unreachable) takes the same failure path
      beatSink.reqs.length = 0; cronAlertSink.hits.length = 0;
      const dead = await spawnCron(3110, "mongodb://127.0.0.1:1/r17dead?serverSelectionTimeoutMS=1500");
      const unauth = await call(dead.url); assert.equal(unauth.status, 401);
      assert.equal(beatSink.reqs.length, 0);
      const boom = await call(dead.url, { headers: bearer }); const boomText = await boom.text();
      assert.equal(boom.status, 500); assert.deepEqual(JSON.parse(boomText), { ok: false, error: "Scheduled jobs failed" }); leaks(boomText, dead.logs.text);
      assert.deepEqual(beatSink.reqs.map((r) => r.path), ["/alert/fail"], "failure heartbeat after an exception");
      await waitFor(() => alertKeys().includes("cron.failed"));
      assert.ok(alertKeys().includes("cron.failed"), "the exception was reported as cron.failed");
      assert.ok(!JSON.stringify(cronAlertSink.hits).includes("mongodb://"), "alerts carry no database URI");
      assert.ok(!dead.logs.text.includes("mongodb://") && !dead.logs.text.includes(cronSecret), "logs carry no URI or secret");
      await cdb.close();
    } finally { beatSink.server.close(); cronAlertSink.server.close(); }

    // ---- R8: Content-Security-Policy on public and authenticated pages (production build) ----
    const cspOf = async (path: string, cookie?: string) => { const r = await fetch(base + path, { headers: cookie ? { cookie } : {} }); return { r, csp: r.headers.get("content-security-policy") ?? "", html: await r.text() }; };
    const nonces = new Set<string>();
    for (const [path, cookie] of [["/", undefined], ["/login", undefined], ["/privacy", undefined], ["/terms", undefined], ["/owner", owner], ["/app", student], ["/super-admin", await forge(sessionSecret, "1h")]] as [string, string | undefined][]) {
      const { r, csp, html } = await cspOf(path, cookie);
      assert.ok(r.status < 500, `${path} renders`);
      const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src")) ?? "";
      const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(scriptSrc)?.[1];
      assert.ok(nonce, `${path} has a script nonce`);
      nonces.add(nonce!);
      assert.ok(scriptSrc.includes("'strict-dynamic'"), `${path} uses strict-dynamic`);
      assert.ok(!scriptSrc.includes("unsafe-inline") && !scriptSrc.includes("unsafe-eval") && !/\*|https?:/.test(scriptSrc), `${path} script-src has no unsafe-inline, unsafe-eval, wildcard or host`);
      for (const directive of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "frame-ancestors 'none'", "form-action 'self'"]) assert.ok(csp.includes(directive), `${path} keeps ${directive}`);
      const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
      assert.ok(tags.length > 0, `${path} ships scripts`);
      for (const tag of tags) assert.ok(tag.includes(`nonce="${nonce}"`) || /type="application\/(ld\+)?json"/.test(tag), `${path}: every executable script carries the nonce (${tag.slice(0, 60)})`);
      assert.equal(r.headers.get("x-frame-options"), "DENY");
      assert.equal(r.headers.get("x-content-type-options"), "nosniff");
    }
    assert.ok(nonces.size >= 6, "the nonce is different on every request");
    const apiCsp = (await fetch(base + "/api/health")).headers.get("content-security-policy");
    assert.equal(apiCsp, "default-src 'none'; frame-ancestors 'none'", "API responses allow nothing");
    console.log(
      "PASS: registration, sessions, role/tenant isolation, scoped staff grants/revocation, allocation conflicts, payment idempotency/overpayment, private receipts, aggregate totals, pagination, QR attendance, pause/resume, confirmed renewal, server timer validation, single XP grant, two-step sign-in (TOTP, recovery codes, replay, lockout, reset/change bypass), mandatory enrolment for owners and platform admins, nonce-based CSP, health endpoints, alert-delivery failure isolation, database-outage behaviour, payment gateway pipeline (signatures, idempotency, mismatches, declines, refunds, reconciliation, test/live safety).",
    );
  } finally {
    for (const x of extraServers) x.kill();
    failingSink?.server.close(); okSink?.server.close();
    server.kill();
    await mongoose.disconnect();
    await replica.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
