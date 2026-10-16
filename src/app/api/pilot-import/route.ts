import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Library, Membership, MembershipPlan, Payment, Seat, SeatAssignment, Shift, StudentProfile, User } from "@/lib/models";
import { ImportBatch, PasswordReset } from "@/lib/ops-models";
import { NotificationDelivery } from "@/lib/saas-models";
import { PlanError, audit, ensureOrganizationForLibrary, requireStudentRoom } from "@/lib/saas-server";
import { integrityReport, validatePilotCsv, type ExistingAssignment } from "@/lib/pilot";
import { hashToken, newToken } from "@/lib/security";
import { sendEmail } from "@/lib/saas-notify";

const err = (message: string, status = 400, extra: object = {}) => NextResponse.json({ error: message, ...extra }, { status });
type Lean = Record<string, unknown> & { _id: unknown };

async function owner() {
  const user = await currentUser();
  if (!user) return { error: err("Sign in required", 401) };
  if (user.role !== "owner" || !user.libraryId) return { error: err("Owner access required", 403) };
  return { user };
}

async function reference(libraryId: unknown) {
  const [seats, shifts, plans, assignments] = await Promise.all([
    Seat.find({ libraryId, operationalStatus: { $ne: "maintenance" } }).select("label").lean<Lean[]>(),
    Shift.find({ libraryId }).select("name start end").lean<(Lean & { name: string; start: number; end: number })[]>(),
    MembershipPlan.find({ libraryId }).select("name amount days").lean<(Lean & { name: string; amount: number; days: number })[]>(),
    SeatAssignment.find({ libraryId, end: { $gt: new Date() } }).select("seatId start end shiftStart shiftEnd").lean<(Lean & ExistingAssignment)[]>(),
  ]);
  return {
    ref: { seats: new Map(seats.map((s) => [String(s.label).toLowerCase(), String(s._id)])), shifts: new Map(shifts.map((s) => [s.name.toLowerCase(), { id: String(s._id), start: s.start, end: s.end }])), plans: new Map(plans.map((p) => [p.name.toLowerCase(), { id: String(p._id), amount: p.amount, days: p.days }])) },
    existing: assignments.map((a) => ({ seatId: String(a.seatId), start: a.start, end: a.end, shiftStart: a.shiftStart, shiftEnd: a.shiftEnd })),
  };
}

/** Post-import reconciliation for the active branch: memberships, payments, seats and dues. */
export async function GET() {
  const o = await owner();
  if ("error" in o) return o.error;
  const libraryId = o.user.libraryId!;
  const [students, memberships, payments, assignments] = await Promise.all([
    User.find({ libraryId, role: "student", deletedAt: { $exists: false } }).select("_id").lean<Lean[]>(),
    Membership.find({ libraryId }).select("userId amount discount paid status").lean<(Lean & { userId: unknown; amount: number; discount?: number; paid?: number; status: string })[]>(),
    Payment.aggregate([{ $match: { libraryId } }, { $group: { _id: "$membershipId", amount: { $sum: "$amount" } } }]),
    SeatAssignment.find({ libraryId, end: { $gt: new Date() } }).select("seatId start end shiftStart shiftEnd").lean<(Lean & ExistingAssignment)[]>(),
  ]);
  const report = integrityReport({
    students: students.map((s) => String(s._id)),
    memberships: memberships.map((m) => ({ id: String(m._id), userId: String(m.userId), amount: m.amount, discount: m.discount ?? 0, paid: m.paid ?? 0, status: m.status })),
    payments: payments.map((p) => ({ membershipId: String(p._id), amount: p.amount })),
    assignments: assignments.map((a) => ({ seatId: String(a.seatId), start: a.start, end: a.end, shiftStart: a.shiftStart, shiftEnd: a.shiftEnd })),
  });
  return NextResponse.json({ ...report, students: students.length, memberships: memberships.length });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const o = await owner();
  if ("error" in o) return o.error;
  const { user } = o;
  const libraryId = user.libraryId!;
  if (limited(`pilot:${user._id}`, 20)) return err("Please slow down", 429);
  try {
    const parsed = z.object({ action: z.enum(["validate", "commit", "invite"]), data: z.object({ csv: z.string().max(500000).optional(), expected: z.object({ paidRupees: z.number().min(0).optional(), dueRupees: z.number().min(0).optional() }).optional(), reviewed: z.boolean().optional() }).default({}) }).parse(await request.json());
    const body = { action: parsed.action, ...parsed.data };
    const orgId = await ensureOrganizationForLibrary(libraryId);

    if (body.action === "invite") {
      const invited = await User.find({ libraryId, role: "student", invited: true, deletedAt: { $exists: false } }).select("email").limit(100).lean<(Lean & { email: string })[]>();
      let sent = 0, skipped = 0, failed = 0, unconfigured = 0;
      const day = new Date().toISOString().slice(0, 10);
      for (const u of invited) {
        const fresh = await NotificationDelivery.updateOne({ key: `invite:${u._id}:${day}` }, { $setOnInsert: { userId: u._id, channel: "email", kind: "invite", status: "pending" } }, { upsert: true });
        if (!fresh.upsertedCount) { skipped++; continue; }
        const token = newToken();
        await PasswordReset.create({ userId: u._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 7 * 86400000) });
        const lib = await Library.findById(libraryId).select("name").lean<{ name: string }>();
        const r = await sendEmail(u.email, `Activate your StudyQuest account at ${lib?.name ?? "your library"}`, `Your library has set up a StudyQuest account for you. Choose a password to activate it: ${process.env.APP_URL ?? ""}/reset-password?token=${token}`);
        if (r === "accepted") sent++; else if (r === "failed") failed++; else unconfigured++;
        await NotificationDelivery.updateOne({ key: `invite:${u._id}:${day}` }, { status: r === "accepted" ? "sent" : r === "failed" ? "failed" : "skipped" });
      }
      return NextResponse.json({ ok: true, invited: invited.length, sent, skipped, failed, notConfigured: unconfigured, note: unconfigured ? "No email provider is configured: students can still activate by using Forgot password with their email." : undefined });
    }

    if (!body.csv) throw new Error("Upload a CSV file");
    const { ref, existing } = await reference(libraryId);
    const result = validatePilotCsv(body.csv, ref, existing);
    // Identity check against accounts that already exist anywhere on the platform.
    const emails = result.rows.map((r) => r.email);
    const accounts = await User.find({ email: { $in: emails } }).select("email role libraryId").lean<(Lean & { email: string; role: string; libraryId?: unknown })[]>();
    for (const a of accounts) {
      const row = result.rows.find((r) => r.email === a.email)!;
      if (a.role !== "student") result.issues.push({ line: row.line, error: "This email belongs to a non-student account" });
      else if (a.libraryId && String(a.libraryId) !== String(libraryId)) result.issues.push({ line: row.line, error: "This student already belongs to another library" });
    }
    const mismatch: string[] = [];
    if (body.expected?.paidRupees !== undefined && Math.round(body.expected.paidRupees * 100) !== result.totals.paidPaise) mismatch.push(`Paid total in the file is ₹${result.totals.paidPaise / 100}, you expected ₹${body.expected.paidRupees}`);
    if (body.expected?.dueRupees !== undefined && Math.round(body.expected.dueRupees * 100) !== result.totals.duePaise) mismatch.push(`Outstanding total in the file is ₹${result.totals.duePaise / 100}, you expected ₹${body.expected.dueRupees}`);
    const hash = createHash("sha256").update(body.csv.trim()).digest("hex");
    const duplicateBatch = await ImportBatch.exists({ libraryId, hash });
    const summary = { totals: result.totals, rows: result.rows.length, issues: result.issues.slice(0, 100), issueCount: result.issues.length, controlTotalMismatches: mismatch, alreadyImported: !!duplicateBatch, existingAccounts: accounts.length, preview: result.rows.slice(0, 10).map((r) => ({ line: r.line, name: r.name, seat: r.seatLabel, start: r.start.toISOString().slice(0, 10), duePaise: r.duePaise })) };
    if (body.action === "validate") return NextResponse.json({ ok: true, canCommit: !result.issues.length && !mismatch.length && !duplicateBatch && result.rows.length > 0, ...summary });

    if (!body.reviewed) throw new Error("Confirm that you reviewed the validation report");
    if (result.issues.length || mismatch.length || duplicateBatch || !result.rows.length) return err("The file did not pass validation. Nothing was imported.", 422, summary);
    await requireStudentRoom(libraryId, result.rows.filter((r) => !accounts.some((a) => a.email === r.email)).length);
    const session = await mongoose.startSession();
    const created = { students: 0, memberships: 0, payments: 0 };
    try {
      await session.withTransaction(async () => {
        created.students = created.memberships = created.payments = 0;
        await ImportBatch.create([{ libraryId, hash, rows: result.rows.length, summary: result.totals, createdBy: user._id }], { session });
        for (const r of result.rows) {
          let student = await User.findOne({ email: r.email }).session(session);
          if (!student) {
            [student] = await User.create([{ name: r.name, email: r.email, passwordHash: await bcrypt.hash(randomBytes(24).toString("hex"), 10), role: "student", libraryId, invited: true }], { session });
            await StudentProfile.create([{ userId: student._id, libraryId }], { session });
            created.students++;
          } else if (!student.libraryId) { student.libraryId = libraryId as never; await student.save({ session }); }
          const [membership] = await Membership.create([{ libraryId, userId: student._id, planId: r.planId, start: r.start, end: r.end, amount: r.pricePaise, discount: r.discountPaise, paid: r.paidPaise }], { session });
          await SeatAssignment.create([{ libraryId, userId: student._id, seatId: r.seatId, membershipId: membership._id, start: r.start, end: r.end, shiftStart: r.shiftStart, shiftEnd: r.shiftEnd }], { session });
          created.memberships++;
          if (r.paidPaise > 0) {
            await Payment.create([{ libraryId, membershipId: membership._id, userId: student._id, amount: r.paidPaise, method: "cash", key: `import:${hash.slice(0, 12)}:${r.line}`, receipt: `IMPORT-${hash.slice(0, 6).toUpperCase()}-${r.line}` }], { session });
            created.payments++;
          }
        }
      });
    } finally { await session.endSession(); }
    await audit({ organizationId: orgId as never, actorId: user._id, actorRole: "org-owner", action: "pilot.import", details: { ...created, ...result.totals } });
    return NextResponse.json({ ok: true, created, totals: result.totals });
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, 402, { code: error.code });
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check the request" : error instanceof Error ? error.message : "Import failed");
  }
}
