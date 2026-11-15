import { test } from "node:test";
import assert from "node:assert/strict";

// Demo-data isolation and PII-free pilot metrics against a disposable MongoDB replica set.
const enabled = !!process.env.TEST_MONGODB_URI;
const withDb = (uri: string, name: string) => uri.replace(/\/(\?|$)/, `/${name}$1`);

test("demo tenants never contaminate real tenants, purge removes only demo data, and pilot metrics carry no personal data", { skip: !enabled }, async () => {
  process.env.SESSION_SECRET = "pilot-integration-session-secret-32-plus-chars";
  delete process.env.APP_ENV;
  const mongoose = (await import("mongoose")).default;
  await mongoose.connect(withDb(process.env.TEST_MONGODB_URI!, "pilot_it"));
  const M = await import("../src/lib/models");
  const S = await import("../src/lib/saas-models");
  const { ensurePlans, createOrganization } = await import("../src/lib/saas-server");
  const { createDemoTenant, purgeDemoTenants, DEMO_PREFIX } = await import("../src/lib/demo-data");
  const { pilotMetrics } = await import("../src/lib/pilot-metrics");
  await ensurePlans();
  const oid = () => new mongoose.Types.ObjectId();

  // A real library with named, contactable people (the data that must never leak or be touched).
  async function realTenant(name: string, students: number, ownerEmail: string) {
    const owner = await M.User.create({ name: `${name} Owner`, email: ownerEmail, passwordHash: "x", role: "owner", twoFactorEnabled: true });
    const lib = await M.Library.create({ name: `${name} Library`, ownerId: owner._id, libraryCode: `LIB-${name.slice(0, 4).toUpperCase()}${students}` });
    await M.User.updateOne({ _id: owner._id }, { libraryId: lib._id });
    const org = await createOrganization({ ownerId: owner._id, name, libraryIds: [lib._id], trialPlanKey: null, billingEmail: ownerEmail });
    const plan = await M.MembershipPlan.create({ libraryId: lib._id, name: "Monthly", amount: 90000, days: 30 });
    const seat = await M.Seat.insertMany(Array.from({ length: students }, (_, i) => ({ libraryId: lib._id, label: `S${i}` })));
    for (let i = 0; i < students; i++) {
      const u = await M.User.create({ name: `Real Student ${name} ${i}`, email: `real.${name.toLowerCase()}.${i}@school.example`, passwordHash: "x", role: "student", libraryId: lib._id });
      const m = await M.Membership.create({ libraryId: lib._id, userId: u._id, planId: plan._id, start: new Date(), end: new Date(Date.now() + 30 * 86400000), amount: 90000, paid: 90000 });
      await M.SeatAssignment.create({ libraryId: lib._id, seatId: seat[i]._id, userId: u._id, membershipId: m._id, start: new Date(), end: new Date(Date.now() + 30 * 86400000) });
      await M.Payment.create({ libraryId: lib._id, membershipId: m._id, userId: u._id, amount: 90000, method: "upi", key: `real-${name}-${i}`, receipt: `R-${name}-${i}` });
      await M.Attendance.create({ libraryId: lib._id, userId: u._id, day: new Date().toISOString().slice(0, 10), checkIn: new Date(), sessions: [{ inAt: new Date(), method: "manual" }] });
      await M.StudentProfile.create({ userId: u._id, libraryId: lib._id });
    }
    return { org, lib, owner };
  }
  const big = await realTenant("Alpha", 4, "alpha.owner@realbiz.example");
  const small = await realTenant("Beta", 2, "beta.owner@realbiz.example");
  await S.SupportTicket.create({ organizationId: big.org._id, libraryId: big.lib._id, createdBy: big.owner._id, subject: "Private subject", category: "account", priority: "high", status: "open", messages: [{ authorId: big.owner._id, role: "owner", body: "Sensitive text", at: new Date() }], history: [{ status: "open", by: big.owner._id, at: new Date() }] });

  // Everything that belongs to the real tenants, across ALL collections, before any demo data exists.
  const names = Object.keys(mongoose.models);
  const snapshot = async () => {
    const out: Record<string, number> = {};
    for (const n of names) {
      const model = mongoose.models[n];
      const filters: Record<string, unknown>[] = [];
      if (model.schema.path("libraryId")) filters.push({ libraryId: { $in: [big.lib._id, small.lib._id] } });
      if (model.schema.path("organizationId")) filters.push({ organizationId: { $in: [big.org._id, small.org._id] } });
      if (n === "User") filters.push({ email: { $regex: "real|owner@realbiz" } });
      if (!filters.length) continue;
      out[n] = await model.countDocuments({ $or: filters });
    }
    return out;
  };
  const before = await snapshot();
  assert.ok(before.User >= 8 && before.Payment === 6 && before.Membership === 6);

  // Demo tenants are labelled, flagged, undeliverable, and isolated.
  const d1 = await createDemoTenant({ label: "Training One", students: 5, seats: 10 });
  const d2 = await createDemoTenant({ label: "Training Two", students: 3, seats: 10 });
  const demoOrgs = await S.Organization.find({ _id: { $in: [d1.organizationId, d2.organizationId] } }).lean();
  assert.ok(demoOrgs.every((o) => o.isTest === true && o.name.startsWith(DEMO_PREFIX)), "flagged isTest and labelled [DEMO]");
  const demoUsers = await M.User.find({ libraryId: { $in: [d1.libraryId, d2.libraryId] } }).select("+passwordHash").lean();
  assert.ok(demoUsers.length === 10 && demoUsers.every((u) => /@demo\.invalid$/.test(u.email) && u.name.startsWith(DEMO_PREFIX)), "only reserved, undeliverable addresses");
  assert.deepEqual(await snapshot(), before, "creating demo data changed nothing in the real tenants");
  assert.ok(!demoUsers.some((u) => u.passwordHash.includes(d1.password)), "the throwaway password is stored hashed only");

  // Metrics: demo excluded, no personal data, small groups suppressed.
  const m = await pilotMetrics({ minGroup: 3 });
  const json = JSON.stringify(m);
  assert.equal(m.organizations, 2, "demo organizations are excluded");
  assert.deepEqual([m.students.total, m.students.withActiveMembership, m.owners.total, m.owners.twoFactorEnrolled], [6, 6, 2, 2]);
  assert.equal(m.activity.paymentsRecorded7d, 6); assert.equal(m.support.openHigh, 1);
  assert.deepEqual(m.perOrganization.map((o) => o.org), ["org-1"], "the 2-member library is reported only inside the totals");
  assert.deepEqual(m.perOrganization[0], { org: "org-1", students: 4, activeMembers: 4, attendance7d: 4, payments7d: 4 });
  for (const leak of ["Alpha", "Beta", "Real Student", "realbiz.example", "school.example", "@", "Private subject", "Sensitive text", "LIB-", String(big.lib._id), String(big.org._id), String(big.owner._id)]) assert.ok(!json.includes(leak), `metrics leak: ${leak}`);
  assert.ok(!/[a-f0-9]{24}/.test(json), "no object ids");
  assert.ok(!/"amount|rupee|paise/i.test(json), "no money amounts either");

  // Purge: a dry run deletes nothing; a confirmed purge removes demo data only; look-alikes are never matched.
  const lookAlikeOrg = await createOrganization({ ownerId: oid(), name: `${DEMO_PREFIX}Real business that is not flagged`, libraryIds: [] });
  const flaggedOtherName = await createOrganization({ ownerId: oid(), name: "Flagged test org without the demo label", libraryIds: [] });
  await S.Organization.updateOne({ _id: flaggedOtherName._id }, { isTest: true });
  const orgsBefore = await S.Organization.countDocuments();
  const dry = await purgeDemoTenants();
  assert.deepEqual([dry.organizations, dry.libraries, dry.users, dry.deleted], [2, 2, 10, false]);
  assert.equal(await S.Organization.countDocuments(), orgsBefore, "dry run deletes nothing");
  const done = await purgeDemoTenants({ confirm: true });
  assert.equal(done.deleted, true);
  assert.equal(await S.Organization.countDocuments(), orgsBefore - 2);
  assert.equal(await S.Organization.countDocuments({ _id: { $in: [lookAlikeOrg._id, flaggedOtherName._id] } }), 2, "an unflagged [DEMO] name or a flagged non-demo name is never purged");
  assert.equal(await M.User.countDocuments({ libraryId: { $in: [d1.libraryId, d2.libraryId] } }), 0);
  for (const n of ["Seat", "Shift", "MembershipPlan", "Membership", "SeatAssignment", "Payment", "Attendance"]) assert.equal(await mongoose.models[n].countDocuments({ libraryId: { $in: [d1.libraryId, d2.libraryId] } }), 0, `${n} of the demo tenants removed`);
  assert.deepEqual(await snapshot(), before, "after the purge every real record is exactly as before");
  assert.equal((await purgeDemoTenants({ confirm: true })).organizations, 0, "idempotent");

  // Never in production.
  process.env.APP_ENV = "production";
  await assert.rejects(createDemoTenant({ label: "Nope" }), /never created in a production deployment/);
  delete process.env.APP_ENV;

  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});
