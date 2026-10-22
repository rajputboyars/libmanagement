import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AuditLog, Library, Notification, Seat, SeatAssignment, SeatChangeRequest, Shift, StaffMembership, User } from "@/lib/models";
import { assertWritable } from "@/lib/saas-server";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
type Lean = Record<string, unknown> & { _id: unknown };

/** Owners always; staff with the memberships or students permission. */
async function team(user: { _id: unknown; role: string; libraryId?: unknown }) {
  if (user.role === "owner" && user.libraryId) return true;
  if (user.role !== "staff" || !user.libraryId) return false;
  const m = await StaffMembership.findOne({ userId: user._id, libraryId: user.libraryId }).lean<{ permissions: string[] }>();
  return !!m?.permissions.some((p) => p === "memberships" || p === "students");
}

/** The student's seat assignment that is running now, or the next one if none has started yet. */
async function currentAssignment(userId: unknown, libraryId: unknown, now = new Date()) {
  return SeatAssignment.findOne({ userId, libraryId, end: { $gt: now } })
    .sort({ start: 1 })
    .lean<Lean & { seatId: unknown; start: Date; end: Date; shiftStart?: number; shiftEnd?: number }>();
}

export async function GET() {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (!user.libraryId) return NextResponse.json({ team: false, requests: [] });
  const isTeam = await team(user);
  const filter = isTeam ? { libraryId: user.libraryId, status: "pending" } : { libraryId: user.libraryId, userId: user._id };
  const rows = await SeatChangeRequest.find(filter)
    .sort({ createdAt: -1 })
    .limit(isTeam ? 100 : 5)
    .lean<Lean[]>();
  const [seats, shifts, users] = await Promise.all([
    Seat.find({ libraryId: user.libraryId }).select("label").lean<(Lean & { label: string })[]>(),
    Shift.find({ libraryId: user.libraryId }).select("name start end").lean<(Lean & { name: string; start: number; end: number })[]>(),
    isTeam
      ? User.find({ _id: { $in: rows.map((r) => r.userId) } }).select("name email").lean<(Lean & { name: string; email: string })[]>()
      : Promise.resolve([] as (Lean & { name: string; email: string })[]),
  ]);
  const seatLabel = (sid: unknown) => seats.find((s) => String(s._id) === String(sid))?.label ?? null;
  const shiftOf = (sid: unknown) => shifts.find((s) => String(s._id) === String(sid)) ?? null;
  return NextResponse.json({
    team: isTeam,
    requests: rows.map((r) => ({
      _id: r._id,
      status: r.status,
      note: r.note,
      decisionNote: r.decisionNote,
      createdAt: r.createdAt,
      fromSeat: seatLabel(r.fromSeatId),
      fromShift: { start: r.fromShiftStart, end: r.fromShiftEnd },
      toSeat: seatLabel(r.toSeatId),
      toShift: shiftOf(r.toShiftId),
      student: isTeam ? (users.find((u) => String(u._id) === String(r.userId)) ?? null) : undefined,
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`seat-change:${user._id}`, 30)) return err("Please slow down", 429);
  if (!user.libraryId) return err("Join a library first");
  const libraryId = user.libraryId;
  try {
    const body = await request.json();
    const action = z.enum(["request", "cancel", "approve", "reject"]).parse(body.action);

    if (action === "request" || action === "cancel") {
      if (user.role !== "student") return err("Only students can request a seat change", 403);
      if (action === "cancel") {
        const res = await SeatChangeRequest.updateOne({ userId: user._id, status: "pending" }, { $set: { status: "cancelled", decidedAt: new Date() } });
        if (!res.modifiedCount) return err("No pending request to cancel", 404);
        return NextResponse.json({ ok: true });
      }
      const v = z
        .object({ seatId: objectId.optional(), shiftId: objectId.optional(), note: z.string().trim().max(300).default("") })
        .refine((x) => x.seatId || x.shiftId, "Choose a new seat or a new shift")
        .parse(body.data);
      const assignment = await currentAssignment(user._id, libraryId);
      if (!assignment) return err("You need an active seat before you can ask to change it");
      const [seat, shift] = await Promise.all([
        v.seatId ? Seat.findOne({ _id: v.seatId, libraryId }).lean<Lean & { operationalStatus?: string }>() : null,
        v.shiftId ? Shift.findOne({ _id: v.shiftId, libraryId }).lean<Lean & { start: number; end: number }>() : null,
      ]);
      if (v.seatId && !seat) return err("That seat is not in your library");
      if (seat?.operationalStatus === "maintenance") return err("That seat is under repair. Choose another one.");
      if (v.shiftId && !shift) return err("That shift is not in your library");
      const sameSeat = !v.seatId || String(v.seatId) === String(assignment.seatId);
      const sameShift = !shift || (shift.start === assignment.shiftStart && shift.end === assignment.shiftEnd);
      if (sameSeat && sameShift) return err("That is already your seat and shift");
      if (await SeatChangeRequest.exists({ userId: user._id, status: "pending" }))
        return err("You already have a pending request. Cancel it to send a new one.");
      await SeatChangeRequest.create({
        libraryId,
        userId: user._id,
        assignmentId: assignment._id,
        fromSeatId: assignment.seatId,
        fromShiftStart: assignment.shiftStart,
        fromShiftEnd: assignment.shiftEnd,
        toSeatId: sameSeat ? undefined : v.seatId,
        toShiftId: sameShift ? undefined : v.shiftId,
        note: v.note,
      });
      const library = await Library.findById(libraryId).select("ownerId").lean<{ ownerId: unknown }>();
      if (library)
        await Notification.create({
          userId: library.ownerId,
          libraryId,
          title: "Seat change request",
          message: `${user.name} asked to change seat or shift. Review it in Join requests.`,
        });
      return NextResponse.json({ ok: true });
    }

    // approve / reject: library team only
    if (!(await team(user))) return err("Only the library team can review seat changes", 403);
    await assertWritable(libraryId);
    const v = z.object({ id: objectId, note: z.string().trim().max(300).default("") }).parse(body.data);
    if (action === "reject") {
      const req = await SeatChangeRequest.findOneAndUpdate(
        { _id: v.id, libraryId, status: "pending" },
        { $set: { status: "rejected", decidedBy: user._id, decidedAt: new Date(), decisionNote: v.note } },
        { new: true },
      ).lean<Lean & { userId: unknown }>();
      if (!req) return err("Request not found or already decided", 404);
      await Notification.create({
        userId: req.userId,
        libraryId,
        title: "Seat change not approved",
        message: v.note || "Your library could not change your seat or shift this time.",
      });
      return NextResponse.json({ ok: true });
    }

    // approve: end the current assignment now and start a new one on the new seat/shift until the same end date.
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        // Serialize tenant writes so two approvals cannot take the same seat.
        await Library.updateOne({ _id: libraryId }, { $inc: { __v: 1 } }, { session });
        const req = await SeatChangeRequest.findOne({ _id: v.id, libraryId, status: "pending" }).session(session);
        if (!req) throw new Error("Request not found or already decided");
        const current = await SeatAssignment.findOne({ _id: req.assignmentId, libraryId }).session(session);
        const now = new Date();
        if (!current || +current.end <= +now) throw new Error("The student's seat assignment has ended");
        const seatId = req.toSeatId ?? current.seatId;
        const shift = req.toShiftId ? await Shift.findOne({ _id: req.toShiftId, libraryId }).session(session) : null;
        if (req.toShiftId && !shift) throw new Error("That shift no longer exists");
        const shiftStart: number | undefined = shift ? shift.start : current.shiftStart;
        const shiftEnd: number | undefined = shift ? shift.end : current.shiftEnd;
        const seat = await Seat.findOne({ _id: seatId, libraryId }).session(session);
        if (!seat) throw new Error("That seat no longer exists");
        if (seat.operationalStatus === "maintenance") throw new Error("That seat is under repair");
        const from = +current.start > +now ? current.start : now;
        const clash = await SeatAssignment.exists({
          libraryId,
          seatId,
          _id: { $ne: current._id },
          start: { $lt: current.end },
          end: { $gt: from },
          ...(shiftStart !== undefined && shiftEnd !== undefined
            ? { shiftStart: { $lt: shiftEnd }, shiftEnd: { $gt: shiftStart } }
            : {}),
        }).session(session);
        if (clash) throw new Error(`Seat ${seat.label} is already taken in that shift`);
        const until = current.end;
        if (+current.start >= +now) await SeatAssignment.deleteOne({ _id: current._id }, { session });
        else {
          current.end = now;
          await current.save({ session });
        }
        await SeatAssignment.create(
          [{ libraryId, userId: current.userId, seatId, membershipId: current.membershipId, start: from, end: until, shiftStart, shiftEnd }],
          { session },
        );
        req.status = "approved";
        req.decidedBy = user._id;
        req.decidedAt = now;
        req.decisionNote = v.note;
        await req.save({ session });
        await AuditLog.create([{ libraryId, actorId: user._id, action: "seat-change.approve", recordId: req._id }], { session });
        await Notification.create(
          [
            {
              userId: current.userId,
              libraryId,
              title: "Seat change approved",
              message: `Your new seat is ${seat.label}${shift ? `, ${shift.name} shift` : ""}. ${v.note}`.trim(),
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err(e.issues[0]?.message ?? "Invalid request");
    return err(e instanceof Error ? e.message : "Could not save");
  }
}
