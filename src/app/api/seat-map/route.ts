import { reportUnexpected } from "@/lib/api-errors";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { assertTeam, can, accessResponse } from "@/lib/access";
import { Attendance, Membership, Seat, SeatAssignment, User } from "@/lib/models";
import { libraryTimeZone } from "@/lib/punch";
import { isRunning, owed } from "@/lib/fees";
import { localMinutes, onShift, seatState, type SeatState } from "@/lib/seat-map";

type Lean = Record<string, unknown> & { _id: unknown };

/** Seat map for the library team: every seat with its live state and who holds it. Staff need students, attendance or payments access. */
export async function GET() {
  const user = await currentUser();
  if (!user || !user.libraryId || !["owner", "staff"].includes(user.role)) return NextResponse.json({ error: "Library team access required" }, { status: 403 });
  let showMoney = false;
  try {
    const a = await assertTeam(user, "seats", "seats.view");
    showMoney = can(a, "fees.view") || can(a, "memberships.view");
  } catch (e) {
    reportUnexpected(e, "/api/seat-map");
    const r = accessResponse(e);
    if (r) return r;
    throw e;
  }
  const libraryId = user.libraryId, now = new Date();
  const [tz, seats, assignments, open] = await Promise.all([
    libraryTimeZone(libraryId),
    Seat.find({ libraryId }).limit(2000).select("label floor operationalStatus").lean<(Lean & { label: string; floor: string; operationalStatus?: string })[]>(),
    SeatAssignment.find({ libraryId, start: { $lte: now }, end: { $gt: now } }).lean<(Lean & { seatId: unknown; userId: unknown; membershipId?: unknown; start: Date; end: Date; shiftStart?: number; shiftEnd?: number })[]>(),
    Attendance.find({ libraryId, sessions: { $elemMatch: { outAt: { $exists: false } } } }).select("userId").lean<(Lean & { userId: unknown })[]>(),
  ]);
  const minute = localMinutes(now, tz);
  const inside = new Set(open.map((o) => String(o.userId)));
  const [students, memberships] = await Promise.all([
    User.find({ _id: { $in: assignments.map((a) => a.userId) }, libraryId }).select("name email").lean<(Lean & { name: string; email: string })[]>(),
    Membership.find({ _id: { $in: assignments.map((a) => a.membershipId).filter(Boolean) }, libraryId }).lean<(Lean & { status: string; start: Date; end: Date; amount: number; discount?: number; paid?: number })[]>(),
  ]);
  const byId = <T extends Lean>(rows: T[]) => new Map(rows.map((r) => [String(r._id), r]));
  const sMap = byId(students), mMap = byId(memberships);
  // Natural order: A2 before A10, floors alphabetically.
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  seats.sort((a, b) => collator.compare(a.floor, b.floor) || collator.compare(a.label, b.label));
  const out = seats.map((seat) => {
    const holders = assignments.filter((a) => String(a.seatId) === String(seat._id)).map((a) => {
      const st = sMap.get(String(a.userId)), m = a.membershipId ? mMap.get(String(a.membershipId)) : undefined;
      return {
        userId: String(a.userId), name: st?.name ?? "Student", email: st?.email ?? "", assignmentId: String(a._id), shiftStart: a.shiftStart, shiftEnd: a.shiftEnd,
        from: a.start, until: a.end, inside: inside.has(String(a.userId)), onShift: onShift({ shiftStart: a.shiftStart, shiftEnd: a.shiftEnd, inside: false }, minute),
        membership: m ? { id: String(m._id), status: m.status, running: isRunning(m, now), ...(showMoney ? { amount: m.amount, discount: m.discount ?? 0, paid: m.paid ?? 0, due: isRunning(m, now) ? owed(m) : 0 } : {}) } : null,
      };
    });
    const state: SeatState = seatState(seat.operationalStatus, holders, minute);
    return { _id: String(seat._id), label: seat.label, floor: seat.floor, state, holders };
  });
  const count = (s: SeatState) => out.filter((x) => x.state === s).length;
  return NextResponse.json({ now, summary: { total: out.length, available: count("available"), booked: count("booked"), assigned: count("assigned"), occupied: count("occupied"), maintenance: count("maintenance") }, seats: out });
}
