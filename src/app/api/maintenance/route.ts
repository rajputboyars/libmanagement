import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AuditLog, MaintenanceIssue, Notification, Seat, SeatAssignment, User } from "@/lib/models";
import { ISSUE_CATEGORIES, ISSUE_PRIORITIES, ISSUE_STATUSES, MAX_REPAIR_COST_PAISE, canTransition, isActiveIssue, seatShouldBeOffline, type IssueStatus } from "@/lib/maintenance";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const team = (role: string) => role === "owner" || role === "staff";

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!user.libraryId) return NextResponse.json({ issues: [], seats: [], page: 1, summary: null, assignees: [] });
  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number(params.get("page") || 1));
  const status = params.get("status");
  const manage = team(user.role);
  const filter: Record<string, unknown> = { libraryId: user.libraryId };
  if (!manage) filter.reporterId = user._id;
  if (status === "active") filter.status = { $in: ["open", "assigned", "in-progress"] };
  else if (status && (ISSUE_STATUSES as readonly string[]).includes(status)) filter.status = status;
  const [issues, seats, counts, costs, assignees] = await Promise.all([
    MaintenanceIssue.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
    Seat.find({ libraryId: user.libraryId }).sort({ label: 1 }).limit(500).select("label floor operationalStatus").lean(),
    manage ? MaintenanceIssue.aggregate([{ $match: { libraryId: user.libraryId } }, { $group: { _id: "$status", count: { $sum: 1 } } }]) : [],
    manage ? MaintenanceIssue.aggregate([{ $match: { libraryId: user.libraryId, status: "resolved" } }, { $group: { _id: null, total: { $sum: "$costPaise" } } }]) : [],
    manage ? User.find({ libraryId: user.libraryId, role: { $in: ["owner", "staff"] } }).select("name").limit(100).lean() : [],
  ]);
  const view = manage
    ? issues
    : issues.map((issue) => {
        const { costPaise, assigneeId, events, ...rest } = issue;
        void costPaise; void assigneeId;
        return { ...rest, events: ((events || []) as { at: Date; status: string; note: string }[]).map((event) => ({ at: event.at, status: event.status, note: event.note })) };
      });
  return NextResponse.json({
    issues: view, seats, page, assignees,
    summary: manage ? { byStatus: Object.fromEntries(counts.map((row) => [row._id, row.count])), repairCostPaise: costs[0]?.total || 0, seatsOffline: seats.filter((seat) => seat.operationalStatus === "maintenance").length } : null,
  });
}

async function syncSeat(seatId: unknown, libraryId: unknown, session: mongoose.ClientSession) {
  if (!seatId) return;
  const issues = await MaintenanceIssue.find({ libraryId, seatId }).select("status seatOffline").session(session).lean();
  await Seat.updateOne({ _id: seatId, libraryId }, { operationalStatus: seatShouldBeOffline(issues as unknown as { status: string; seatOffline: boolean }[]) ? "maintenance" : "available" }, { session });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!user.libraryId) return NextResponse.json({ error: "Join a library first" }, { status: 400 });
  if (limited(`maintenance:${user._id}`, 20)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  try {
    const body = z.object({ action: z.enum(["issue-report", "issue-update"]), data: z.unknown() }).parse(await request.json());
    const libraryId = user.libraryId;
    const manage = team(user.role);
    if (body.action === "issue-report") {
      if (!manage && user.role !== "student") throw new Error("Access denied");
      const value = z.object({
        seatId: objectId.optional(), category: z.enum(ISSUE_CATEGORIES), title: z.string().trim().min(3).max(120),
        description: z.string().trim().max(800).default(""), priority: z.enum(ISSUE_PRIORITIES).default("medium"), seatOffline: z.boolean().default(false),
      }).parse(body.data);
      if (!manage && (value.seatOffline || value.priority !== "medium")) throw new Error("Only the library team sets priority or seat status");
      if (value.seatOffline && !value.seatId) throw new Error("Choose the seat to take offline");
      if (value.seatId && !await Seat.exists({ _id: value.seatId, libraryId })) throw new Error("Seat not found");
      if (await MaintenanceIssue.exists({ libraryId, reporterId: user._id, seatId: value.seatId ?? null, title: value.title, status: { $in: ["open", "assigned", "in-progress"] } })) throw new Error("You already reported this issue");
      const session = await mongoose.startSession();
      let record;
      let affectedAssignments = 0;
      try {
        await session.withTransaction(async () => {
          [record] = await MaintenanceIssue.create([{ ...value, libraryId, reporterId: user._id, events: [{ at: new Date(), actorId: user._id, status: "open", note: "Reported" }] }], { session });
          if (value.seatOffline) {
            await syncSeat(value.seatId, libraryId, session);
            affectedAssignments = await SeatAssignment.countDocuments({ libraryId, seatId: value.seatId, end: { $gt: new Date() } }).session(session);
          }
          await AuditLog.create([{ libraryId, actorId: user._id, action: "maintenance-report", recordId: record._id }], { session });
        });
      } finally { await session.endSession(); }
      return NextResponse.json({ ok: true, record, affectedAssignments });
    }
    if (!manage) throw new Error("Library team access required");
    const value = z.object({
      id: objectId, status: z.enum(ISSUE_STATUSES).optional(), priority: z.enum(ISSUE_PRIORITIES).optional(),
      assigneeId: objectId.nullable().optional(), costPaise: z.number().int().min(0).max(MAX_REPAIR_COST_PAISE).optional(),
      seatOffline: z.boolean().optional(), note: z.string().trim().max(400).default(""),
    }).parse(body.data);
    if (value.costPaise !== undefined && user.role !== "owner") throw new Error("Only the owner records repair costs");
    if (value.assigneeId && !await User.exists({ _id: value.assigneeId, libraryId, role: { $in: ["owner", "staff"] } })) throw new Error("Assignee must be on your team");
    const session = await mongoose.startSession();
    let record;
    let affectedAssignments = 0;
    try {
      await session.withTransaction(async () => {
        const issue = await MaintenanceIssue.findOne({ _id: value.id, libraryId }).session(session);
        if (!issue) throw new Error("Issue not found");
        const from = issue.status as IssueStatus;
        let to = value.status ?? from;
        if (value.assigneeId && !value.status && from === "open") to = "assigned";
        if (to !== from && !canTransition(from, to)) throw new Error(`Cannot move an issue from ${from} to ${to}`);
        if (value.priority) issue.priority = value.priority;
        if (value.assigneeId !== undefined) issue.assigneeId = value.assigneeId as never;
        if (value.costPaise !== undefined) issue.costPaise = value.costPaise;
        if (value.seatOffline !== undefined) {
          if (value.seatOffline && !issue.seatId) throw new Error("This issue is not linked to a seat");
          if (value.seatOffline && !isActiveIssue(to)) throw new Error("A closed issue cannot keep a seat offline");
          issue.seatOffline = value.seatOffline;
        }
        if (to !== from) {
          issue.status = to;
          issue.resolvedAt = to === "resolved" ? new Date() : undefined;
        }
        issue.events.push({ at: new Date(), actorId: user._id, status: to, note: value.note || (to === from ? "Updated" : `Status: ${to}`) } as never);
        await issue.save({ session });
        await syncSeat(issue.seatId, libraryId, session);
        if (issue.seatId && issue.seatOffline && isActiveIssue(issue.status)) affectedAssignments = await SeatAssignment.countDocuments({ libraryId, seatId: issue.seatId, end: { $gt: new Date() } }).session(session);
        if (to !== from) await Notification.create([{ libraryId, userId: issue.reporterId, title: "Maintenance update", message: `"${issue.title}" is now ${to.replace("-", " ")}.` }], { session });
        await AuditLog.create([{ libraryId, actorId: user._id, action: `maintenance-${to}`, recordId: issue._id }], { session });
        record = issue;
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ ok: true, record, affectedAssignments });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update maintenance" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
