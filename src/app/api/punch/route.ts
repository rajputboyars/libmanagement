import { jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, secret, validOrigin } from "@/lib/auth";
import { Attendance, Library, Membership, Seat, SeatAssignment, StaffMembership, User } from "@/lib/models";
import { dayKey, openSession, punchIn, punchOut, sessionMinutes, closeStaleSessions, type Session } from "@/lib/punch";
import { PlanError, assertWritable, audit, ensureOrganizationForLibrary } from "@/lib/saas-server";

const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
type Lean = Record<string, unknown> & { _id: unknown };
type Day = Lean & { day: string; sessions?: Session[]; checkIn?: Date; checkOut?: Date };

async function activeMembership(userId: unknown, libraryId: unknown, now = new Date()) {
  return Membership.findOne({ userId, libraryId, status: "active", start: { $lte: now }, end: { $gt: now } }).select("end").lean<{ end: Date }>();
}
async function team(user: { _id: unknown; role: string; libraryId?: unknown }) {
  if (user.role === "owner" && user.libraryId) return true;
  if (user.role !== "staff" || !user.libraryId) return false;
  const m = await StaffMembership.findOne({ userId: user._id, libraryId: user.libraryId }).lean<{ permissions: string[] }>();
  return !!m?.permissions.includes("attendance");
}
const shape = (d: Day, now: Date) => ({ day: d.day, sessions: (d.sessions ?? (d.checkIn ? [{ inAt: d.checkIn, outAt: d.checkOut }] : [])).map((s) => ({ inAt: s.inAt, outAt: s.outAt ?? null, method: s.method ?? "app", auto: !!s.auto })), minutes: sessionMinutes(d.sessions ?? (d.checkIn ? [{ inAt: d.checkIn, outAt: d.checkOut }] : []), now) });

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  const now = new Date();
  const params = request.nextUrl.searchParams;

  if (user.role === "student") {
    if (!user.libraryId) return NextResponse.json({ linked: false });
    await closeStaleSessions({ userId: user._id, libraryId: user.libraryId }, now);
    const [library, membership, days] = await Promise.all([
      Library.findById(user.libraryId).select("name punchPolicy").lean<{ name: string; punchPolicy?: string }>(),
      activeMembership(user._id, user.libraryId, now),
      Attendance.find({ userId: user._id, libraryId: user.libraryId, day: { $gte: dayKey(new Date(now.getTime() - 14 * 86400000)) } }).sort({ day: -1 }).lean<Day[]>(),
    ]);
    const rows = days.map((d) => shape(d, now));
    const open = days.flatMap((d) => d.sessions ?? []).find((s) => !s.outAt);
    const week = rows.filter((r) => r.day >= dayKey(new Date(now.getTime() - 6 * 86400000))).reduce((s, r) => s + r.minutes, 0);
    return NextResponse.json({ linked: true, library: library?.name, policy: library?.punchPolicy ?? "app", membershipActive: !!membership, membershipEnds: membership?.end ?? null, inside: !!open, since: open?.inAt ?? null, today: rows.find((r) => r.day === dayKey(now)) ?? { day: dayKey(now), sessions: [], minutes: 0 }, history: rows, weekMinutes: week, serverNow: now });
  }

  // Library team: who is inside now and the log for a day.
  if (!(await team(user))) return err("Library team access required", 403);
  const libraryId = user.libraryId!;
  const day = /^\d{4}-\d{2}-\d{2}$/.test(params.get("day") ?? "") ? params.get("day")! : dayKey(now);
  await closeStaleSessions({ libraryId }, now);
  const [records, openDocs] = await Promise.all([
    Attendance.find({ libraryId, day }).lean<Day[]>(),
    Attendance.find({ libraryId, sessions: { $elemMatch: { outAt: { $exists: false } } } }).lean<Day[]>(),
  ]);
  const ids = [...new Set([...records, ...openDocs].map((r) => String(r.userId)))];
  const [users, assignments] = await Promise.all([
    User.find({ _id: { $in: ids } }).select("name").lean<(Lean & { name: string })[]>(),
    SeatAssignment.find({ libraryId, userId: { $in: ids }, start: { $lte: now }, end: { $gt: now } }).select("userId seatId").lean<(Lean & { userId: unknown; seatId: unknown })[]>(),
  ]);
  const seats = await Seat.find({ _id: { $in: assignments.map((a) => a.seatId) } }).select("label").lean<(Lean & { label: string })[]>();
  const name = (id: unknown) => users.find((u) => String(u._id) === String(id))?.name ?? "Student";
  const seatOf = (id: unknown) => { const a = assignments.find((x) => String(x.userId) === String(id)); return a ? seats.find((s) => String(s._id) === String(a.seatId))?.label ?? null : null; };
  const log = records.map((r) => ({ userId: r.userId, name: name(r.userId), seat: seatOf(r.userId), ...shape(r, now) })).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    day, inside: openDocs.map((d) => ({ userId: d.userId, name: name(d.userId), seat: seatOf(d.userId), since: openSession(d.sessions ?? [])?.inAt })).sort((a, b) => +new Date(a.since as Date) - +new Date(b.since as Date)),
    log, totals: { students: log.length, minutes: log.reduce((s, r) => s + r.minutes, 0), autoClosed: log.filter((r) => r.sessions.some((s) => s.auto)).length }, serverNow: now,
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`punch:${user._id}`, 60)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.enum(["in", "out", "manual-out"]), data: z.object({ token: z.string().max(2000).optional(), userId: z.string().regex(/^[a-f\d]{24}$/i).optional() }).default({}) }).parse(await request.json());
    const now = new Date();

    if (body.action === "manual-out") {
      if (!(await team(user))) return err("Library team access required", 403);
      const target = body.data.userId;
      if (!target || !(await User.exists({ _id: target, libraryId: user.libraryId, role: "student" }))) throw new Error("Student not found");
      const r = await punchOut({ libraryId: user.libraryId, userId: target, now });
      if (!r.ok) throw new Error("This student is not punched in");
      await Attendance.updateOne({ _id: r.record._id, "sessions.outAt": now }, { $set: { "sessions.$.method": "manual" } });
      const orgId = await ensureOrganizationForLibrary(user.libraryId!);
      await audit({ organizationId: orgId as never, actorId: user._id, actorRole: user.role, action: "attendance.manual-out", targetType: "user", targetId: target });
      return NextResponse.json({ ok: true });
    }

    if (user.role !== "student") return err("Student access required", 403);
    if (!user.libraryId) throw new Error("Join a library first: enter your Library ID.");
    await assertWritable(user.libraryId);
    if (body.action === "in") {
      if (!(await activeMembership(user._id, user.libraryId, now))) throw new Error("Your library has not activated your membership yet. Once they verify you and allot a seat, you can punch in.");
      const library = await Library.findById(user.libraryId).select("punchPolicy").lean<{ punchPolicy?: string }>();
      let method: "app" | "qr" = "app";
      if (library?.punchPolicy === "qr") {
        // This library requires proof of presence: the signed code shown at the desk must be scanned.
        if (!body.data.token) throw new Error("This library asks you to scan the QR code at the desk to punch in.");
        const { payload } = await jwtVerify(body.data.token, secret(), { algorithms: ["HS256"] }).catch(() => { throw new Error("That QR code has expired or is invalid. Scan the current code at the desk."); });
        if (payload.purpose !== "attendance" || payload.libraryId !== String(user.libraryId)) throw new Error("This QR code is not for your library.");
        method = "qr";
      }
      const r = await punchIn({ libraryId: user.libraryId, userId: user._id, method, now });
      if (!r.ok) throw new Error("You are already punched in. Punch out when you leave.");
      return NextResponse.json({ ok: true, at: now });
    }
    const r = await punchOut({ libraryId: user.libraryId, userId: user._id, now });
    if (!r.ok) throw new Error("You are not punched in.");
    const session = (r.record.sessions as Session[]).filter((s) => s.outAt && new Date(s.outAt).getTime() === now.getTime())[0];
    return NextResponse.json({ ok: true, at: now, minutes: session ? sessionMinutes([session]) : 0 });
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, 402, error.code);
    return err(error instanceof z.ZodError ? "Check your entries" : error instanceof Error ? error.message : "Unable to record", error instanceof z.ZodError ? 422 : 400);
  }
}
