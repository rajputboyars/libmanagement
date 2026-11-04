import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { StudySession } from "../src/lib/models";
import { SignJWT } from "jose";
async function main() {
  const replica = await MongoMemoryReplSet.create({
    replSet: { count: 1 },
    binary: { version: "7.0.14" },
  });
  const base = "http://127.0.0.1:3101";
  const sessionSecret = randomBytes(32).toString("hex");
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
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  server.stderr.on("data", (chunk) => process.stderr.write(chunk));
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
          name: "Integration Person",
          email,
          password,
          role,
          library: "Integration Library",
        }),
      });
      assert.equal(response.status, 200, await response.text());
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
    await post(other, "payments", { ...payment, key: "cross-tenant" }, 400);
    await post(student, "focus.start");
    await post(student, "focus.complete", {}, 400);
    await mongoose.connect(replica.getUri());
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
    const adminUser = await User.create({ name: "Admin", email: "admin@example.invalid", passwordHash: "x", role: "super-admin" });
    const adminCookie = "sq-session=" + (await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(String(adminUser._id)).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(sessionSecret)));
    const pa = (action: string, data: unknown, status = 200, cookie = adminCookie) => api("/api/prep-admin", cookie, action, data, status);
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
    assert.ok((await getJson("/api/workspace", owner)).students.length >= 1, "data is retained on the free plan");
    const orgLibs = await LibraryModel.find({ organizationId: ctx.organization._id }).select("_id").lean();
    await S.PendingStudent.insertMany(Array.from({ length: 30 }, (_, i) => ({ libraryId: orgLibs[0]._id, organizationId: ctx.organization._id, name: `Pending ${i}`, email: `pending${i}@example.invalid` })));
    const overLimit = await fetch(base + "/api/workspace", { method: "POST", headers: { cookie: owner, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action: "students", data: { email: "outsider@example.invalid", name: "Outsider" } }) });
    assert.equal(overLimit.status, 402);
    assert.equal((await overLimit.json()).code, "limit");
    await S.PendingStudent.deleteMany({ email: /^pending\d+@/ });
    // billing in sandbox: checkout → verified events → active
    const billing0 = await getJson("/api/billing", owner);
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
    const register = (email: string, extra: object = {}) => fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ name: "Referred Owner", email, password: rb(12).toString("hex"), role: "owner", library: "Referred Library", ...extra }) });
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
    assert.equal((await send("/api/auth/register", { name: "Evil", email: "evil@example.invalid", password: pw(), role: "super-admin" }, { Origin: base })).status, 400, "cannot self-register as admin");

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
    const activate = await send("/api/auth/reset", { token: inviteToken, password: pw() }, { Origin: base });
    assert.equal(activate.status, 200);
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
    const badReg = await send("/api/auth/register", { name: "Typo Student", email: "typo@join.invalid", password: pw(), role: "student", libraryCode: "LIB-ZZZZZZ" }, { Origin: base });
    assert.equal(badReg.status, 200); assert.notEqual((await rawJson(badReg)).join, "requested");
    // register with the Library ID → pending request
    const joinPassword = pw();
    const reg1 = await send("/api/auth/register", { name: "Join Student", email: "join1@join.invalid", password: joinPassword, role: "student", libraryCode }, { Origin: base });
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
    await AttendanceDoc.updateOne({ userId: joinerUser!._id, day: new Date().toISOString().slice(0, 10) }, { $push: { sessions: { inAt: new Date(Date.now() - 20 * 3600000), method: "app" } } });
    const afterStale = await getJson("/api/punch", joiner);
    assert.equal(afterStale.inside, false, "a visit open for 20 hours is closed automatically");
    assert.ok(afterStale.today.sessions.some((s: { auto: boolean }) => s.auto));
    await pu(joiner, "in"); await pu(joiner, "out");
    const joinedLibId = String((await User.findById(joinerUser!._id))!.libraryId);
    // QR proof-of-presence mode
    await jr(libOwner, "set-policy", { punchPolicy: "qr" });
    assert.match((await pu(joiner, "in", {}, 400)).error, /scan the QR/i);
    assert.match((await pu(joiner, "in", { token: "not-a-token" }, 400)).error, /expired or is invalid/i);
    const makeToken = async (lib: string, purpose = "attendance") => new SignJWT({ libraryId: lib, purpose }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(new TextEncoder().encode(sessionSecret));
    assert.match((await pu(joiner, "in", { token: await makeToken(String(otherCtx.activeBranchId)) }, 400)).error, /not for your library/i);
    assert.match((await pu(joiner, "in", { token: await makeToken(joinedLibId, "other") }, 400)).error, /not for your library/i);
    await pu(joiner, "in", { token: await makeToken(joinedLibId) });
    await pu(joiner, "out"); // leaving never needs a code
    await jr(libOwner, "set-policy", { punchPolicy: "app" });
    await jr(libOwner, "set-policy", { punchPolicy: "qr" }); await jr(libOwner, "set-policy", { punchPolicy: "app" });
    await jr(joiner, "set-policy", { punchPolicy: "qr" }, 403);
    // rejection path
    const reg2 = await send("/api/auth/register", { name: "Rejected Student", email: "join2@join.invalid", password: pw(), role: "student", libraryCode }, { Origin: base });
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
    await AttendanceDoc.updateOne({ userId: joinerUser!._id, day: new Date().toISOString().slice(0, 10) }, { $push: { sessions: { inAt: new Date(Date.now() - 30 * 3600000), method: "app" } } });
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
    await pu(joiner, "in", near);
    assert.match((await pu(joiner, "out", far, 400)).error, /out of geolocation/i);
    assert.equal((await getJson("/api/punch", joiner)).inside, true, "still inside after a rejected punch-out");
    await pu(joiner, "out", near);
    await pu(joiner, "in", near);
    await pu(libOwner, "manual-out", { userId: String(joinerUser!._id) }); // the owner's manual close needs no location
    assert.equal((await getJson("/api/punch", joiner)).inside, false);
    console.log(
      "PASS: registration, sessions, role/tenant isolation, scoped staff grants/revocation, allocation conflicts, payment idempotency/overpayment, private receipts, aggregate totals, pagination, QR attendance, pause/resume, confirmed renewal, server timer validation, single XP grant.",
    );
  } finally {
    server.kill();
    await mongoose.disconnect();
    await replica.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
