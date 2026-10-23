import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Library, Notification, StaffMembership, StudentProfile, User } from "@/lib/models";
import { JoinRequest } from "@/lib/ops-models";
import { ensureLibraryCode } from "@/lib/join";
import { PUNCH_RADIUS_M, normalizeLibraryCode } from "@/lib/punch";
import { PlanError, assertWritable, audit, ensureOrganizationForLibrary, requireFeature, requireStudentRoom } from "@/lib/saas-server";
import { limitedShared } from "@/lib/security";
import { createJoinRequest } from "@/lib/join-request";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
type Lean = Record<string, unknown> & { _id: unknown };

type JoinDoc = InstanceType<typeof JoinRequest>;
/** Links the student to the request's library and marks the request approved, in one transaction. */
async function linkStudent(req: JoinDoc, decidedBy: unknown, message: string) {
  const libraryId = req.libraryId;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const student = await User.findOne({ _id: req.userId, role: "student" }).session(session);
      if (!student || student.deletedAt) throw new Error("This student account is no longer available");
      if (student.libraryId && String(student.libraryId) !== String(libraryId)) throw new Error("This student already belongs to another library");
      student.libraryId = libraryId as never;
      await student.save({ session });
      await StudentProfile.updateOne({ userId: student._id }, { libraryId }, { session });
      req.status = "approved"; req.decidedBy = decidedBy as never; req.decidedAt = new Date();
      await req.save({ session });
      await Notification.create([{ userId: student._id, libraryId, title: "Library membership verified", message }], { session });
    });
  } finally { await session.endSession(); }
}

/** Owners always; staff only with the students permission. */
async function team(user: { _id: unknown; role: string; libraryId?: unknown }) {
  if (user.role === "owner" && user.libraryId) return true;
  if (user.role !== "staff" || !user.libraryId) return false;
  const m = await StaffMembership.findOne({ userId: user._id, libraryId: user.libraryId }).lean<{ permissions: string[] }>();
  return !!m?.permissions.includes("students");
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  const params = request.nextUrl.searchParams;
  const code = params.get("code");
  // Preview of a Library ID so a student can confirm they typed the right library. Reveals only name and city.
  if (code !== null) {
    if (!user) return err("Sign in required", 401);
    if (await limitedShared(`join-lookup:${user._id}`, 30, 600)) return err("Too many lookups. Try again in a few minutes.", 429);
    const normalized = normalizeLibraryCode(code);
    const library = normalized ? await Library.findOne({ libraryCode: normalized }).select("name branchName city").lean<{ name: string; branchName?: string; city?: string }>() : null;
    if (!library) return err("No library found with that ID. Check it with the library desk.", 404);
    return NextResponse.json({ library: { name: library.name, city: library.city || "" }, code: normalized });
  }
  if (!user) return err("Sign in required", 401);

  if (params.get("view") === "requests" || params.get("view") === "owner") {
    if (!(await team(user))) return err("Library team access required", 403);
    const libraryId = user.libraryId!;
    const [libraryCode, library] = await Promise.all([ensureLibraryCode(libraryId), Library.findById(libraryId).select("punchPolicy name geofence").lean<{ punchPolicy?: string; name: string; geofence?: { lat?: number; lng?: number } }>()]);
    const status = params.get("status") === "all" ? undefined : "pending";
    const rows = await JoinRequest.find({ libraryId, ...(status ? { status } : {}) }).sort({ createdAt: -1 }).limit(100).lean<(Lean & { userId: unknown })[]>();
    const students = await User.find({ _id: { $in: rows.map((r) => r.userId) } }).select("name email libraryId").lean<(Lean & { name: string; email: string; libraryId?: unknown })[]>();
    return NextResponse.json({ code: libraryCode, library: { name: library?.name, punchPolicy: library?.punchPolicy ?? "app", location: typeof library?.geofence?.lat === "number" && typeof library.geofence.lng === "number" ? { lat: library.geofence.lat, lng: library.geofence.lng } : null, radiusM: PUNCH_RADIUS_M }, requests: rows.map((r) => ({ ...r, student: students.find((s) => String(s._id) === String(r.userId)) ? { name: students.find((s) => String(s._id) === String(r.userId))!.name, email: students.find((s) => String(s._id) === String(r.userId))!.email } : null })) });
  }

  if (user.role !== "student") return err("Student access required", 403);
  const [library, requests] = await Promise.all([
    user.libraryId ? Library.findById(user.libraryId).select("name city libraryCode").lean<{ name: string; city?: string; libraryCode?: string }>() : null,
    JoinRequest.find({ userId: user._id }).sort({ createdAt: -1 }).limit(5).lean<Lean[]>(),
  ]);
  const libs = await Library.find({ _id: { $in: requests.map((r) => r.libraryId) } }).select("name city").lean<(Lean & { name: string; city?: string })[]>();
  return NextResponse.json({ linked: library ? { name: library.name, city: library.city || "", code: library.libraryCode } : null, requests: requests.map((r) => ({ ...r, library: libs.find((l) => String(l._id) === String(r.libraryId)) ? { name: libs.find((l) => String(l._id) === String(r.libraryId))!.name } : null })) });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`join:${user._id}`, 20)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());

    if (body.action === "request") {
      if (user.role !== "student") throw new Error("Only student accounts can join a library");
      const v = z.object({ code: z.string().min(4).max(20), message: z.string().trim().max(300).default("") }).parse(body.data);
      if (await limitedShared(`join-request:${user._id}`, 10, 3600)) throw new Error("Too many requests. Try again later.");
      const record = await createJoinRequest(user._id, v.code, v.message);
      return NextResponse.json({ ok: true, record });
    }
    if (body.action === "invite-accept" || body.action === "invite-decline") {
      if (user.role !== "student") throw new Error("Student access required");
      const v = z.object({ id: objectId }).parse(body.data);
      const invite = await JoinRequest.findOne({ _id: v.id, userId: user._id, status: "pending", invitedBy: { $exists: true } });
      if (!invite) throw new Error("Invite not found");
      if (body.action === "invite-decline") {
        invite.status = "rejected"; invite.decidedBy = user._id as never; invite.decidedAt = new Date(); await invite.save();
        return NextResponse.json({ ok: true });
      }
      await assertWritable(invite.libraryId);
      await requireStudentRoom(invite.libraryId);
      await linkStudent(invite, user._id, "Welcome! You joined the library. They will allot your seat soon.");
      return NextResponse.json({ ok: true });
    }
    if (body.action === "cancel") {
      if (user.role !== "student") throw new Error("Student access required");
      const v = z.object({ id: objectId }).parse(body.data);
      const r = await JoinRequest.findOneAndUpdate({ _id: v.id, userId: user._id, status: "pending" }, { status: "cancelled", decidedAt: new Date() }, { new: true });
      if (!r) throw new Error("Pending request not found");
      return NextResponse.json({ ok: true });
    }

    // Everything below is for the library team.
    if (!(await team(user))) return err("Library team access required", 403);
    const libraryId = user.libraryId!;
    if (body.action === "approve" || body.action === "reject") {
      const v = z.object({ id: objectId, note: z.string().trim().max(300).default("") }).parse(body.data);
      const req = await JoinRequest.findOne({ _id: v.id, libraryId, status: "pending" });
      if (!req) throw new Error("Pending request not found");
      if (req.invitedBy && body.action === "approve") throw new Error("The student has to accept this invite themselves");
      if (req.invitedBy) {
        req.status = "cancelled"; req.decidedBy = user._id as never; req.decidedAt = new Date(); await req.save();
        return NextResponse.json({ ok: true, record: req });
      }
      if (body.action === "reject") {
        req.status = "rejected"; req.note = v.note; req.decidedBy = user._id as never; req.decidedAt = new Date(); await req.save();
        await Notification.create({ userId: req.userId, title: "Library request not approved", message: v.note ? `The library could not approve your request: ${v.note}` : "The library could not approve your request. Please check your Library ID with the desk." });
      } else {
        await assertWritable(libraryId);
        await requireStudentRoom(libraryId);
        req.note = v.note;
        await linkStudent(req, user._id, "Your library verified your registration. They will allot your seat; once it is active you can punch in and out from the app.");
      }
      const orgId = await ensureOrganizationForLibrary(libraryId);
      await audit({ organizationId: orgId as never, actorId: user._id, actorRole: user.role, action: `join.${body.action}`, targetType: "user", targetId: String(req.userId) });
      return NextResponse.json({ ok: true, record: req });
    }
    if (body.action === "set-policy") {
      if (user.role !== "owner") throw new Error("Only the owner can change this");
      const v = z.object({ punchPolicy: z.enum(["app", "qr"]) }).parse(body.data);
      if (v.punchPolicy === "qr") await requireFeature(libraryId, "qr-attendance", "QR-verified attendance");
      await Library.updateOne({ _id: libraryId }, { punchPolicy: v.punchPolicy });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "set-location") {
      if (user.role !== "owner") throw new Error("Only the owner can set the library location");
      const v = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).parse(body.data);
      await Library.updateOne({ _id: libraryId }, { geofence: { lat: v.lat, lng: v.lng } });
      const orgId = await ensureOrganizationForLibrary(libraryId);
      await audit({ organizationId: orgId as never, actorId: user._id, actorRole: user.role, action: "library.set-location", targetType: "library", targetId: String(libraryId) });
      return NextResponse.json({ ok: true, radiusM: PUNCH_RADIUS_M });
    }
    throw new Error("Unsupported action");
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, 402, error.code);
    if ((error as { code?: number }).code === 11000) return err("You already have a pending request");
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check your entries" : error instanceof Error ? error.message : "Unable to update", error instanceof z.ZodError ? 422 : 400);
  }
}
