import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import mongoose, { type Types } from "mongoose";
import { Attendance, Library, Membership, MembershipPlan, Payment, Seat, SeatAssignment, Shift, StudentProfile, User } from "./models";
import { Organization } from "./saas-models";
import { createOrganization, ensurePlans } from "./saas-server";

/**
 * Clearly labelled SYNTHETIC demo tenants for rehearsals and training. They can never be mistaken for, or contaminate, real library data:
 *  - organization and library names start with "[DEMO] ", the organization is flagged isTest (excluded from revenue, weekly reports and pilot metrics),
 *  - every account uses the reserved, undeliverable domain @demo.invalid and a throwaway random password,
 *  - purge removes ONLY organizations that are flagged isTest AND carry the [DEMO] name prefix, and only data scoped to them.
 * Refused outright in a production deployment (APP_ENV=production).
 */
export const DEMO_PREFIX = "[DEMO] ";
export const DEMO_DOMAIN = "demo.invalid";

export function assertDemoAllowed(env: Record<string, string | undefined> = process.env) {
  if (env.APP_ENV === "production") throw new Error("Demo data is never created in a production deployment. Use staging or a local database.");
}

const FIRST = ["Asha", "Ravi", "Meena", "Karan", "Divya", "Imran", "Neha", "Vikram", "Sana", "Arjun"];
export async function createDemoTenant(opts: { label: string; students?: number; seats?: number; now?: Date }) {
  assertDemoAllowed();
  await ensurePlans();
  const now = opts.now ?? new Date();
  const tag = randomBytes(3).toString("hex");
  const slug = `${opts.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 20) || "demo"}-${tag}`;
  const password = randomBytes(12).toString("base64url");
  const passwordHash = await bcrypt.hash(password, 10);
  const owner = await User.create({ name: `${DEMO_PREFIX}Owner`, email: `owner.${slug}@${DEMO_DOMAIN}`, passwordHash, role: "owner" });
  const library = await Library.create({ name: `${DEMO_PREFIX}${opts.label} Library`, ownerId: owner._id, libraryCode: `DEMO-${tag.toUpperCase()}`, capacity: opts.seats ?? 20 });
  await User.updateOne({ _id: owner._id }, { libraryId: library._id });
  const org = await createOrganization({ ownerId: owner._id, name: `${DEMO_PREFIX}${opts.label}`, libraryIds: [library._id], trialPlanKey: null, billingEmail: `billing.${slug}@${DEMO_DOMAIN}` });
  await Organization.updateOne({ _id: org._id }, { isTest: true });
  const seatCount = opts.seats ?? 20;
  const seats = await Seat.insertMany(Array.from({ length: seatCount }, (_, i) => ({ libraryId: library._id, label: `D${i + 1}` })));
  await Shift.create({ libraryId: library._id, name: "Morning (demo)", start: 360, end: 720 });
  const plan = await MembershipPlan.create({ libraryId: library._id, name: "Monthly (demo)", amount: 100000, days: 30 });
  const students: Types.ObjectId[] = [];
  const count = Math.min(opts.students ?? 5, seatCount);
  const day = now.toISOString().slice(0, 10);
  for (let i = 0; i < count; i++) {
    const s = await User.create({ name: `${DEMO_PREFIX}${FIRST[i % FIRST.length]} ${i + 1}`, email: `student${i + 1}.${slug}@${DEMO_DOMAIN}`, passwordHash, role: "student", libraryId: library._id });
    await StudentProfile.create({ userId: s._id, libraryId: library._id });
    const end = new Date(now.getTime() + 30 * 86400000);
    const m = await Membership.create({ libraryId: library._id, userId: s._id, planId: plan._id, start: now, end, amount: 100000, paid: 60000 });
    await SeatAssignment.create({ libraryId: library._id, seatId: seats[i]._id, userId: s._id, membershipId: m._id, start: now, end });
    await Payment.create({ libraryId: library._id, membershipId: m._id, userId: s._id, amount: 60000, method: i % 2 ? "upi" : "cash", key: `demo-${tag}-${i}`, receipt: `DEMO-${tag}-${i + 1}` });
    await Attendance.create({ libraryId: library._id, userId: s._id, day, checkIn: now, sessions: [{ inAt: now, method: "manual" }] });
    students.push(s._id);
  }
  return { organizationId: org._id, libraryId: library._id, ownerEmail: owner.email, password, students: students.length };
}

/** Collections that carry a tenant or user key, discovered from the registered schemas so new models are covered automatically. */
function modelsWith(path: string) {
  return Object.values(mongoose.models).filter((m) => !!m.schema.path(path));
}

/**
 * Deletes demo tenants (isTest + "[DEMO] " prefix) and everything scoped to them. Without `confirm` it only reports what it would remove.
 * Real tenants are never matched: every filter is restricted to the demo organization, its libraries or its @demo.invalid users.
 */
export async function purgeDemoTenants(opts: { confirm?: boolean } = {}) {
  const orgs = await Organization.find({ isTest: true, name: { $regex: `^\\[DEMO\\] ` } }).select("_id").lean<{ _id: Types.ObjectId }[]>();
  const orgIds = orgs.map((o) => o._id);
  const libs = await Library.find({ organizationId: { $in: orgIds }, name: { $regex: `^\\[DEMO\\] ` } }).select("_id ownerId").lean<{ _id: Types.ObjectId; ownerId: Types.ObjectId }[]>();
  const libIds = libs.map((l) => l._id);
  const demoUsers = await User.find({ email: { $regex: `@${DEMO_DOMAIN.replace(".", "\\.")}$` }, $or: [{ libraryId: { $in: libIds } }, { _id: { $in: libs.map((l) => l.ownerId) } }] }).select("_id").lean<{ _id: Types.ObjectId }[]>();
  const userIds = demoUsers.map((u) => u._id);
  const plan: { model: string; filter: Record<string, unknown> }[] = [];
  for (const m of modelsWith("libraryId")) if (m.modelName !== "Library") plan.push({ model: m.modelName, filter: { libraryId: { $in: libIds } } });
  for (const m of modelsWith("organizationId")) plan.push({ model: m.modelName, filter: { organizationId: { $in: orgIds } } });
  for (const m of modelsWith("userId")) plan.push({ model: m.modelName, filter: { userId: { $in: userIds } } });
  const summary: Record<string, number> = {};
  for (const p of plan) {
    const model = mongoose.models[p.model];
    const n = await model.countDocuments(p.filter);
    if (n) summary[p.model] = (summary[p.model] ?? 0) + n;
    if (opts.confirm && n) await model.deleteMany(p.filter);
  }
  const base = { organizations: orgIds.length, libraries: libIds.length, users: userIds.length };
  if (opts.confirm) {
    await User.deleteMany({ _id: { $in: userIds } });
    await Library.deleteMany({ _id: { $in: libIds } });
    await Organization.deleteMany({ _id: { $in: orgIds } });
  }
  return { ...base, related: summary, deleted: !!opts.confirm };
}
