import { randomBytes } from "node:crypto";
import type { ClientSession, Types } from "mongoose";
import { Library, User } from "./models";
import { Organization, OrganizationMembership, PendingStudent, PlatformSettings, SaaSAuditLog, SaaSPlan, SaaSSubscription } from "./saas-models";
import { DEFAULT_PLANS, resolveEntitlements, type PlanSnapshot } from "./saas";

type Id = Types.ObjectId | string;
type Sess = { session?: ClientSession };

export async function ensurePlans() {
  if (await SaaSPlan.estimatedDocumentCount()) return;
  for (const p of DEFAULT_PLANS)
    await SaaSPlan.updateOne({ key: p.key, version: 1 }, { $setOnInsert: { ...p, current: true, isPublic: true, providerPlanIds: {} } }, { upsert: true });
}
export async function getSettings() {
  return (await PlatformSettings.findOneAndUpdate({ key: "default" }, { $setOnInsert: { key: "default" } }, { upsert: true, new: true }).lean()) as unknown as {
    taxMode: "none" | "inclusive" | "exclusive"; taxRateBps: number; gstin: string; legalName: string; graceDays: number; referralEnabled: boolean; referralRewardPaise: number; referralMonthlyCap: number; invoicePrefix: string;
  };
}
export const snapshotOf = (p: { name: string; monthlyPaise: number; annualPaise: number; limits: { activeStudents: number; branches: number }; features: string[] }): PlanSnapshot => ({ name: p.name, monthlyPaise: p.monthlyPaise, annualPaise: p.annualPaise, limits: { activeStudents: p.limits.activeStudents, branches: p.limits.branches }, features: [...p.features] });
export async function currentPlan(key: string) {
  await ensurePlans();
  return SaaSPlan.findOne({ key, current: true }).lean() as unknown as Promise<(PlanSnapshot & { key: string; version: number; trialDays: number; providerPlanIds: Record<string, Record<string, string>> }) | null>;
}
export const newReferralCode = () => `SQ${randomBytes(4).toString("hex").toUpperCase()}`;

export async function audit(entry: { organizationId?: Id; actorId: Id; actorRole?: string; action: string; targetType?: string; targetId?: string; details?: unknown }, opts: Sess = {}) {
  await SaaSAuditLog.create([entry], { session: opts.session });
}

/** Creates the organization, owner membership and starting subscription. `trialPlanKey` null → free plan. */
export async function createOrganization(input: { ownerId: Id; name: string; libraryIds: Id[]; trialPlanKey?: string | null; trialDaysOverride?: number; referralCode?: string; billingEmail?: string }, opts: Sess = {}) {
  const { session } = opts;
  const trialPlan = input.trialPlanKey ? await currentPlan(input.trialPlanKey) : null;
  const free = (await currentPlan("free"))!;
  const [org] = await Organization.create([{ ownerId: input.ownerId, name: input.name, referralCode: newReferralCode(), referredByCode: input.referralCode?.toUpperCase(), billingEmail: input.billingEmail }], { session });
  await OrganizationMembership.create([{ organizationId: org._id, userId: input.ownerId, role: "org-owner", branchIds: [] }], { session });
  await Library.updateMany({ _id: { $in: input.libraryIds } }, { organizationId: org._id }, { session });
  const days = input.trialDaysOverride ?? trialPlan?.trialDays ?? 0;
  const now = new Date();
  const useTrial = !!trialPlan && days > 0;
  const plan = useTrial ? trialPlan! : free;
  await SaaSSubscription.create([{
    organizationId: org._id, planKey: plan.key, planVersion: plan.version, planSnapshot: snapshotOf(plan), interval: "monthly",
    status: useTrial ? "trialing" : "active", trialStart: useTrial ? now : undefined, trialEnd: useTrial ? new Date(now.getTime() + days * 86400000) : undefined,
    source: useTrial ? "trial" : "free", mode: "none", history: [{ at: now, status: useTrial ? "trialing" : "active", planKey: plan.key, reason: useTrial ? "Trial started" : "Free plan" }],
  }], { session });
  return org;
}

/** Migration for single-library accounts: wrap the library in an organization with a time-limited Pro trial. */
export async function ensureOrganizationForLibrary(libraryId: Id) {
  const library = await Library.findById(libraryId).lean<{ _id: Types.ObjectId; name: string; ownerId: Types.ObjectId; organizationId?: Types.ObjectId }>();
  if (!library) return null;
  if (library.organizationId) return library.organizationId;
  await ensurePlans();
  const existing = await Organization.findOne({ ownerId: library.ownerId }).select("_id").lean<{ _id: Types.ObjectId }>();
  if (existing) { await Library.updateOne({ _id: library._id }, { organizationId: existing._id }); return existing._id; }
  const owner = await User.findById(library.ownerId).select("email").lean<{ email: string }>();
  const org = await createOrganization({ ownerId: library.ownerId, name: library.name, libraryIds: [library._id], trialPlanKey: "pro", trialDaysOverride: 30, billingEmail: owner?.email });
  return org._id;
}

export async function activeStudentCount(organizationId: Id) {
  const libs = await Library.find({ organizationId }).select("_id").lean<{ _id: Types.ObjectId }[]>();
  const ids = libs.map((l) => l._id);
  const [linked, pending] = await Promise.all([User.countDocuments({ role: "student", libraryId: { $in: ids } }), PendingStudent.countDocuments({ libraryId: { $in: ids }, status: "pending" })]);
  return linked + pending;
}

export async function accessForLibrary(libraryId: Id) {
  const orgId = await ensureOrganizationForLibrary(libraryId);
  if (!orgId) return null;
  const [org, sub, settings, free] = await Promise.all([Organization.findById(orgId).lean<{ _id: Types.ObjectId; name: string; status: string; suspendedReason: string; isTest: boolean }>(), SaaSSubscription.findOne({ organizationId: orgId }).lean(), getSettings(), currentPlan("free")]);
  if (!org) return null;
  const entitlements = resolveEntitlements(sub as never, snapshotOf(free!), new Date(), settings.graceDays);
  return { org, sub: sub as unknown as Record<string, unknown> | null, entitlements, settings };
}

export class PlanError extends Error {
  code: string;
  constructor(message: string, code = "plan") { super(message); this.code = code; }
}
/** Throws when the organization is suspended. Reads and exports stay available. */
export async function assertWritable(libraryId: Id) {
  const access = await accessForLibrary(libraryId);
  if (access?.org.status === "suspended") throw new PlanError(`This account is suspended${access.org.suspendedReason ? `: ${access.org.suspendedReason}` : ""}. Contact support. Your data is kept and can be exported.`, "suspended");
  return access;
}
export async function requireFeature(libraryId: Id, feature: string, label: string) {
  const access = await assertWritable(libraryId);
  if (!access || !access.entitlements.features.includes(feature))
    throw new PlanError(`${label} is not included in your current plan (${access?.entitlements.planName ?? "Free"}). ${access?.entitlements.reason ?? ""} Upgrade from Billing to use it.`.trim(), "feature");
  return access;
}
export async function requireStudentRoom(libraryId: Id, adding = 1) {
  const access = await assertWritable(libraryId);
  if (!access) return;
  const used = await activeStudentCount(access.org._id);
  if (used + adding > access.entitlements.limits.activeStudents)
    throw new PlanError(`Your ${access.entitlements.planName} plan allows ${access.entitlements.limits.activeStudents} active students (you have ${used}). Upgrade from Billing to add more.`, "limit");
}

// ── Branch access ──
export type OrgRole = "org-owner" | "branch-manager" | "staff";
export async function membershipsFor(userId: Id) {
  return OrganizationMembership.find({ userId }).lean<{ organizationId: Types.ObjectId; role: OrgRole; branchIds: Types.ObjectId[] }[]>();
}
/** Every branch the user may open, resolved on the server from memberships. */
export async function accessibleBranches(user: { _id: Id; role: string; libraryId?: Id }) {
  if (user.role === "owner" && user.libraryId) await ensureOrganizationForLibrary(user.libraryId);
  const ms = await membershipsFor(user._id);
  const out: { _id: Types.ObjectId; name: string; branchName: string; organizationId: Types.ObjectId; role: OrgRole }[] = [];
  for (const m of ms) {
    const filter = m.role === "org-owner" ? { organizationId: m.organizationId } : { organizationId: m.organizationId, _id: { $in: m.branchIds } };
    const libs = await Library.find(filter).select("name branchName organizationId").sort({ createdAt: 1 }).lean<{ _id: Types.ObjectId; name: string; branchName: string; organizationId: Types.ObjectId }[]>();
    libs.forEach((l) => out.push({ ...l, role: m.role }));
  }
  return out;
}
export async function verifyBranchAccess(user: { _id: Id; role: string; libraryId?: Id }, branchId: string, roles?: OrgRole[]) {
  const branches = await accessibleBranches(user);
  const hit = branches.find((b) => String(b._id) === branchId && (!roles || roles.includes(b.role)));
  if (!hit) throw new PlanError("You do not have access to that branch", "forbidden");
  return hit;
}
/** Org-level access (not tied to a branch): only org owners. */
export async function verifyOrgOwner(user: { _id: Id; role: string; libraryId?: Id }) {
  if (user.role === "owner" && user.libraryId) await ensureOrganizationForLibrary(user.libraryId);
  const m = await OrganizationMembership.findOne({ userId: user._id, role: "org-owner" }).lean<{ organizationId: Types.ObjectId }>();
  if (!m) throw new PlanError("Organization owner access required", "forbidden");
  return m.organizationId;
}
export async function linkPendingStudent(userId: Id, email: string) {
  const pending = await PendingStudent.findOne({ email: email.toLowerCase(), status: "pending" }).sort({ createdAt: 1 });
  if (!pending) return null;
  await User.updateOne({ _id: userId, libraryId: { $exists: false } }, { libraryId: pending.libraryId });
  pending.status = "linked";
  await pending.save();
  return pending.libraryId;
}

