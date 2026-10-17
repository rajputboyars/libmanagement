import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Library, Membership, SeatAssignment, StaffMembership, StudentProfile, User } from "@/lib/models";
import { Organization, OrganizationMembership, StudentTransfer } from "@/lib/saas-models";
import { newLibraryCode } from "@/lib/join";
import { PlanError, accessForLibrary, accessibleBranches, activeStudentCount, assertWritable, audit, verifyBranchAccess, verifyOrgOwner } from "@/lib/saas-server";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
const MANAGER_PERMISSIONS = ["attendance", "students", "payments", "expenses", "memberships", "membership-status", "renew", "resolve"];

export async function GET() {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (!["owner", "staff"].includes(user.role) || !user.libraryId) return err("Library team access required", 403);
  const branches = await accessibleBranches(user);
  const access = await accessForLibrary(user.libraryId);
  if (!access) return err("Organization not found", 404);
  const orgId = access.org._id;
  const mine = branches.find((b) => String(b.organizationId) === String(orgId));
  const [used, members] = await Promise.all([
    activeStudentCount(orgId),
    mine?.role === "org-owner" ? OrganizationMembership.find({ organizationId: orgId }).lean() : [],
  ]);
  const memberUsers = await User.find({ _id: { $in: (members as { userId: unknown }[]).map((m) => m.userId) } }).select("name email").lean<{ _id: unknown; name: string; email: string }[]>();
  return NextResponse.json({
    organization: { _id: orgId, name: access.org.name, status: access.org.status, suspendedReason: access.org.suspendedReason },
    role: mine?.role ?? "staff", activeBranchId: String(user.libraryId),
    branches: branches.filter((b) => String(b.organizationId) === String(orgId)).map((b) => ({ _id: b._id, name: b.name, branchName: b.branchName, role: b.role })),
    entitlements: access.entitlements, usage: { activeStudents: used, branches: branches.filter((b) => String(b.organizationId) === String(orgId)).length },
    members: (members as { userId: unknown; role: string; branchIds: unknown[] }[]).map((m) => ({ ...m, user: memberUsers.find((u) => String(u._id) === String(m.userId)) })),
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (!["owner", "staff"].includes(user.role) || !user.libraryId) return err("Library team access required", 403);
  if (limited(`org:${user._id}`, 40)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    let record: unknown;
    switch (body.action) {
      case "switch-branch": {
        const v = z.object({ branchId: objectId }).parse(body.data);
        const hit = await verifyBranchAccess(user, v.branchId);
        await User.updateOne({ _id: user._id }, { libraryId: hit._id });
        record = { activeBranchId: v.branchId };
        break;
      }
      case "org-update": {
        const orgId = await verifyOrgOwner(user);
        const v = z.object({ name: z.string().trim().min(2).max(100) }).parse(body.data);
        await assertWritable(user.libraryId);
        record = await Organization.findByIdAndUpdate(orgId, { name: v.name }, { new: true });
        await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "org.update" });
        break;
      }
      case "branch-create": {
        const orgId = await verifyOrgOwner(user);
        const v = z.object({ branchName: z.string().trim().min(2).max(80), city: z.string().trim().max(80).default(""), address: z.string().trim().max(200).default("") }).parse(body.data);
        const access = await assertWritable(user.libraryId);
        const count = await Library.countDocuments({ organizationId: orgId });
        if (count >= 1 && !access!.entitlements.features.includes("multi-branch")) throw new PlanError("Multiple branches are available on the Business plan. Upgrade from Billing.", "feature");
        if (count + 1 > access!.entitlements.limits.branches) throw new PlanError(`Your plan allows ${access!.entitlements.limits.branches} branch(es).`, "limit");
        const org = await Organization.findById(orgId).lean<{ ownerId: unknown; name: string }>();
        record = await Library.create({ libraryCode: newLibraryCode(), name: `${org!.name} — ${v.branchName}`, branchName: v.branchName, ownerId: org!.ownerId, organizationId: orgId, city: v.city, address: v.address });
        await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "branch.create", targetType: "library", targetId: String((record as { _id: unknown })._id) });
        break;
      }
      case "branch-update": {
        const v = z.object({ branchId: objectId, branchName: z.string().trim().min(2).max(80), city: z.string().trim().max(80).default(""), address: z.string().trim().max(200).default("") }).parse(body.data);
        const hit = await verifyBranchAccess(user, v.branchId, ["org-owner", "branch-manager"]);
        await assertWritable(hit._id);
        record = await Library.findByIdAndUpdate(hit._id, { branchName: v.branchName, city: v.city, address: v.address }, { new: true });
        await audit({ organizationId: hit.organizationId, actorId: user._id, actorRole: hit.role, action: "branch.update", targetType: "library", targetId: v.branchId });
        break;
      }
      case "member-add": {
        const orgId = await verifyOrgOwner(user);
        const v = z.object({ email: z.email(), role: z.enum(["branch-manager", "staff"]), branchIds: z.array(objectId).min(1).max(20) }).parse(body.data);
        await assertWritable(user.libraryId);
        const owned = await Library.find({ organizationId: orgId, _id: { $in: v.branchIds } }).select("_id").lean<{ _id: unknown }[]>();
        if (owned.length !== new Set(v.branchIds).size) throw new Error("Choose branches from your organization");
        const member = await User.findOne({ email: v.email.toLowerCase() });
        if (!member || member.role === "super-admin" || member.role === "owner") throw new Error("Use a registered account that is not an owner");
        if (member.libraryId && !(await Library.exists({ _id: member.libraryId, organizationId: orgId }))) throw new Error("This account belongs to another organization");
        if (await Membership.exists({ userId: member._id, status: "active" })) throw new Error("An active student membership cannot become a staff account");
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            member.role = "staff";
            if (!member.libraryId) member.libraryId = owned[0]._id as never;
            await member.save({ session });
            await OrganizationMembership.updateOne({ organizationId: orgId, userId: member._id }, { $set: { role: v.role, branchIds: v.branchIds } }, { upsert: true, session });
            for (const b of v.branchIds)
              await StaffMembership.updateOne({ libraryId: b, userId: member._id }, { $set: { permissions: v.role === "branch-manager" ? MANAGER_PERMISSIONS : ["attendance"] } }, { upsert: true, session });
          });
        } finally { await session.endSession(); }
        await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "member.add", targetType: "user", targetId: String(member._id), details: { role: v.role, branchIds: v.branchIds } });
        record = { userId: member._id };
        break;
      }
      case "member-remove": {
        const orgId = await verifyOrgOwner(user);
        const v = z.object({ userId: objectId }).parse(body.data);
        const m = await OrganizationMembership.findOne({ organizationId: orgId, userId: v.userId });
        if (!m || m.role === "org-owner") throw new Error("Member not found");
        const branchIds = (await Library.find({ organizationId: orgId }).select("_id").lean<{ _id: unknown }[]>()).map((l) => l._id);
        await StaffMembership.deleteMany({ userId: v.userId, libraryId: { $in: branchIds } });
        await OrganizationMembership.deleteOne({ _id: m._id });
        await User.updateOne({ _id: v.userId, libraryId: { $in: branchIds } }, { role: "student", $unset: { libraryId: 1 } });
        await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "member.remove", targetType: "user", targetId: v.userId });
        record = { removed: true };
        break;
      }
      case "student-transfer": {
        const v = z.object({ studentId: objectId, toBranchId: objectId, note: z.string().trim().max(300).default("") }).parse(body.data);
        const student = await User.findOne({ _id: v.studentId, role: "student" });
        if (!student?.libraryId) throw new Error("Student not found");
        const from = await verifyBranchAccess(user, String(student.libraryId), ["org-owner", "branch-manager"]);
        const to = await verifyBranchAccess(user, v.toBranchId, ["org-owner", "branch-manager"]);
        if (String(from.organizationId) !== String(to.organizationId)) throw new Error("Branches belong to different organizations");
        if (String(from._id) === String(to._id)) throw new Error("Student is already in that branch");
        await assertWritable(to._id);
        if (await Membership.exists({ userId: student._id, libraryId: from._id, status: { $in: ["active", "paused"] } })) throw new Error("Cancel or complete the student's active membership in the current branch before transferring");
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            // Financial history (memberships, payments) stays on the old branch untouched; only the student's home branch moves.
            await SeatAssignment.updateMany({ libraryId: from._id, userId: student._id, end: { $gt: new Date() } }, { end: new Date() }, { session });
            student.libraryId = to._id as never;
            await student.save({ session });
            await StudentProfile.updateOne({ userId: student._id }, { libraryId: to._id }, { session });
            [record] = await StudentTransfer.create([{ organizationId: from.organizationId, studentId: student._id, fromLibraryId: from._id, toLibraryId: to._id, actorId: user._id, note: v.note }], { session });
          });
        } finally { await session.endSession(); }
        await audit({ organizationId: from.organizationId, actorId: user._id, actorRole: from.role, action: "student.transfer", targetType: "user", targetId: v.studentId, details: { from: String(from._id), to: String(to._id) } });
        break;
      }
      default: throw new Error("Unsupported action");
    }
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, error.code === "forbidden" ? 403 : 402, error.code);
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update", error instanceof z.ZodError ? 422 : 400);
  }
}

