import { NextRequest, NextResponse } from "next/server";
import { Types } from "mongoose";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AuditLog, MembershipPlan, Membership, Notification, Payment, StaffMembership, User } from "@/lib/models";
import { NotificationDelivery } from "@/lib/saas-models";
import { isRunning, owedExpr, runningExpr, feeTotals } from "@/lib/fees";
import { dayKey, libraryTimeZone } from "@/lib/punch";
import { PlanError, assertWritable } from "@/lib/saas-server";

const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
type Lean = Record<string, unknown> & { _id: unknown };
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const escapeRe = (q: string) => q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Fee views are for the owner and for staff who were given the payments permission. */
async function feeTeam() {
  const user = await currentUser();
  if (!user || !user.libraryId) return { error: err("Sign in required", 401) };
  if (user.role === "owner") return { user, libraryId: user.libraryId, owner: true };
  if (user.role === "staff") {
    const m = await StaffMembership.findOne({ userId: user._id, libraryId: user.libraryId }).lean<{ permissions: string[] }>();
    if (m?.permissions.includes("payments")) return { user, libraryId: user.libraryId, owner: false };
  }
  return { error: err("Fee access required", 403) };
}

export async function GET(request: NextRequest) {
  const t = await feeTeam();
  if ("error" in t) return t.error;
  const { libraryId } = t;
  const params = request.nextUrl.searchParams;
  const now = new Date();

  // One student: every membership with its payments (reversed ones stay visible, marked as reversed).
  const studentId = params.get("student");
  if (studentId) {
    if (!objectId.safeParse(studentId).success) return err("Student not found", 404);
    const student = await User.findOne({ _id: studentId, libraryId, role: "student" }).select("name email").lean<Lean & { name: string; email: string }>();
    if (!student) return err("Student not found", 404);
    const [memberships, payments] = await Promise.all([
      Membership.find({ libraryId, userId: studentId }).sort({ start: -1 }).limit(100).lean<(Lean & { planId?: unknown; start: Date; end: Date; status: string; amount: number; discount?: number; paid?: number })[]>(),
      Payment.find({ libraryId, userId: studentId }).sort({ createdAt: -1 }).limit(200).select("-key").lean<Lean[]>(),
    ]);
    const plans = await MembershipPlan.find({ _id: { $in: memberships.map((m) => m.planId).filter(Boolean) }, libraryId }).select("name").lean<(Lean & { name: string })[]>();
    const totals = feeTotals(memberships, now);
    return NextResponse.json({
      student: { _id: String(student._id), name: student.name, email: student.email }, totals,
      memberships: memberships.map((m) => ({ ...m, plan: plans.find((p) => String(p._id) === String(m.planId))?.name ?? null, running: isRunning(m, now) })),
      payments,
    });
  }

  // Student-wise list.
  const filter = ["pending", "clear", "all"].includes(params.get("filter") ?? "") ? params.get("filter")! : "pending";
  const page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1)), size = 25;
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  let ids: Types.ObjectId[] | undefined;
  if (q) {
    const re = { $regex: escapeRe(q), $options: "i" };
    ids = (await User.find({ libraryId, role: "student", $or: [{ name: re }, { email: re }] }).limit(500).select("_id").lean<{ _id: Types.ObjectId }[]>()).map((u) => u._id);
  }
  const keep = filter === "pending" ? { pending: { $gt: 0 } } : filter === "clear" ? { pending: 0 } : {};
  const [agg] = await Membership.aggregate([
    { $match: { libraryId, ...(ids ? { userId: { $in: ids } } : {}) } },
    { $addFields: { owed: owedExpr, running: runningExpr(now), net: { $subtract: ["$amount", { $ifNull: ["$discount", 0] }] } } },
    {
      $group: {
        _id: "$userId",
        pending: { $sum: { $cond: ["$running", "$owed", 0] } },
        closedBalance: { $sum: { $cond: [{ $and: [{ $ne: ["$status", "cancelled"] }, { $not: ["$running"] }] }, "$owed", 0] } },
        billed: { $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, "$net", 0] } },
        paid: { $sum: { $cond: [{ $ne: ["$status", "cancelled"] }, { $ifNull: ["$paid", 0] }, 0] } },
        runningCount: { $sum: { $cond: ["$running", 1, 0] } },
        lastEnd: { $max: "$end" },
      },
    },
    {
      $facet: {
        rows: [{ $match: keep }, { $sort: { pending: -1, _id: 1 } }, { $skip: (page - 1) * size }, { $limit: size }],
        count: [{ $match: keep }, { $count: "n" }],
        totals: [{ $group: { _id: null, pending: { $sum: "$pending" }, closedBalance: { $sum: "$closedBalance" }, paid: { $sum: "$paid" }, owing: { $sum: { $cond: [{ $gt: ["$pending", 0] }, 1, 0] } }, students: { $sum: 1 } } }],
      },
    },
  ]);
  const rows = (agg?.rows ?? []) as (Lean & { pending: number; closedBalance: number; billed: number; paid: number; runningCount: number; lastEnd: Date })[];
  const userIds = rows.map((r) => r._id);
  const [users, lastPay] = await Promise.all([
    User.find({ _id: { $in: userIds }, libraryId }).select("name email").lean<(Lean & { name: string; email: string })[]>(),
    Payment.aggregate([{ $match: { libraryId, userId: { $in: userIds }, reversedAt: { $exists: false } } }, { $group: { _id: "$userId", at: { $max: "$createdAt" } } }]),
  ]);
  const t0 = agg?.totals?.[0] ?? { pending: 0, closedBalance: 0, paid: 0, owing: 0, students: 0 };
  return NextResponse.json({
    filter, page, pageSize: size, total: agg?.count?.[0]?.n ?? 0,
    totals: { pending: t0.pending, closedBalance: t0.closedBalance, paid: t0.paid, owing: t0.owing, students: t0.students },
    students: rows.map((r) => {
      const u = users.find((x) => String(x._id) === String(r._id));
      return { userId: String(r._id), name: u?.name ?? "Student", email: u?.email ?? "", pending: r.pending, closedBalance: r.closedBalance, billed: r.billed, paid: r.paid, running: r.runningCount, validUntil: r.lastEnd, lastPaymentAt: lastPay.find((p) => String(p._id) === String(r._id))?.at ?? null };
    }),
  });
}

/** Fee reminders go out as ordinary in-app notifications (which also reach phones with web push). */
export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const t = await feeTeam();
  if ("error" in t) return t.error;
  const { user, libraryId } = t;
  if (limited(`fees:${user._id}`, 20)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.literal("remind"), data: z.object({ userIds: z.array(objectId).max(500).optional() }).default({}) }).parse(await request.json());
    await assertWritable(libraryId);
    const now = new Date();
    const wanted = body.data.userIds?.map((x) => new Types.ObjectId(x));
    const owing = await Membership.aggregate([
      { $match: { libraryId, ...(wanted ? { userId: { $in: wanted } } : {}) } },
      { $addFields: { owed: owedExpr, running: runningExpr(now) } },
      { $group: { _id: "$userId", pending: { $sum: { $cond: ["$running", "$owed", 0] } } } },
      { $match: { pending: { $gt: 0 } } },
      { $limit: 500 },
    ]);
    const students = await User.find({ _id: { $in: owing.map((o) => o._id) }, libraryId, role: "student", deletedAt: { $exists: false } }).select("_id").lean<{ _id: Types.ObjectId }[]>();
    const valid = new Set(students.map((s) => String(s._id)));
    const day = dayKey(now, await libraryTimeZone(libraryId));
    let sent = 0, skipped = 0;
    for (const o of owing) {
      if (!valid.has(String(o._id))) continue;
      // One reminder per student per day, however many times the button is pressed.
      const fresh = await NotificationDelivery.updateOne({ key: `feemanual:${o._id}:${day}` }, { $setOnInsert: { userId: o._id, channel: "in-app", kind: "fee-due", status: "sent", attempts: 1 } }, { upsert: true });
      if (!fresh.upsertedCount) { skipped++; continue; }
      await Notification.create({ userId: o._id, libraryId, title: "Library fee reminder", message: `You have ₹${(o.pending / 100).toLocaleString("en-IN")} outstanding. Please settle it with the library desk.` });
      sent++;
    }
    await AuditLog.create({ libraryId, actorId: user._id, action: "fees.remind", recordId: libraryId });
    return NextResponse.json({ ok: true, sent, skipped });
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, 402, error.code);
    return err(error instanceof z.ZodError ? "Check your entries" : error instanceof Error ? error.message : "Unable to send reminders", error instanceof z.ZodError ? 422 : 400);
  }
}
