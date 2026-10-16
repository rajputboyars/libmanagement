import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { Expense, Library, Membership, Payment, Seat, SeatAssignment, User } from "@/lib/models";
import { AdmissionLead } from "@/lib/saas-models";
import { rate } from "@/lib/saas";
import { PlanError, accessibleBranches, accessForLibrary } from "@/lib/saas-server";

const sum = async (Model: typeof Payment, match: object) => (await Model.aggregate([{ $match: match }, { $group: { _id: null, t: { $sum: "$amount" } } }]))[0]?.t ?? 0;

/** Per-branch performance for the branches the caller may open. Comparison needs the advanced-reports entitlement. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!["owner", "staff"].includes(user.role) || !user.libraryId) return NextResponse.json({ error: "Library team access required" }, { status: 403 });
  try {
    const access = await accessForLibrary(user.libraryId);
    if (!access) return NextResponse.json({ error: "Organization not found" }, { status: 404 });
    const branches = (await accessibleBranches(user)).filter((b) => String(b.organizationId) === String(access.org._id) && ["org-owner", "branch-manager"].includes(b.role));
    if (!branches.length) return NextResponse.json({ error: "Branch manager access required" }, { status: 403 });
    const advanced = access.entitlements.features.includes("advanced-reports");
    const scope = advanced ? branches : branches.filter((b) => String(b._id) === String(user.libraryId));
    const days = Math.min(365, Math.max(7, Number(request.nextUrl.searchParams.get("days") || 30)));
    const from = new Date(Date.now() - days * 86400000), now = new Date();
    const rows = await Promise.all(scope.map(async (b) => {
      const libraryId = b._id;
      const [students, newStudents, seats, inUse, activeMemberships, revenue, expenses, leads, converted] = await Promise.all([
        User.countDocuments({ role: "student", libraryId }), User.countDocuments({ role: "student", libraryId, createdAt: { $gte: from } }),
        Seat.countDocuments({ libraryId, operationalStatus: { $ne: "maintenance" } }), SeatAssignment.distinct("seatId", { libraryId, start: { $lte: now }, end: { $gt: now } }),
        Membership.countDocuments({ libraryId, status: "active", end: { $gt: now } }), sum(Payment as never, { libraryId, createdAt: { $gte: from } }), sum(Expense as never, { libraryId, date: { $gte: from } }),
        AdmissionLead.countDocuments({ libraryId, createdAt: { $gte: from } }), AdmissionLead.countDocuments({ libraryId, createdAt: { $gte: from }, stage: "converted" }),
      ]);
      const lib = await Library.findById(libraryId).select("name branchName").lean<{ name: string; branchName: string }>();
      return { branchId: libraryId, name: lib?.branchName || lib?.name, students, newStudents, seats, seatsInUse: inUse.length, utilizationPct: rate(inUse.length, seats), activeMemberships, revenuePaise: revenue, expensesPaise: expenses, netPaise: revenue - expenses, leads, converted, leadConversionPct: rate(converted, leads) };
    }));
    const total = rows.reduce((t, r) => ({ students: t.students + r.students, revenuePaise: t.revenuePaise + r.revenuePaise, expensesPaise: t.expensesPaise + r.expensesPaise, netPaise: t.netPaise + r.netPaise, seats: t.seats + r.seats, seatsInUse: t.seatsInUse + r.seatsInUse, leads: t.leads + r.leads, converted: t.converted + r.converted }), { students: 0, revenuePaise: 0, expensesPaise: 0, netPaise: 0, seats: 0, seatsInUse: 0, leads: 0, converted: 0 });
    return NextResponse.json({ days, comparison: advanced, branches: rows, total: { ...total, utilizationPct: rate(total.seatsInUse, total.seats), leadConversionPct: rate(total.converted, total.leads) }, note: advanced ? undefined : "Branch comparison is part of advanced reporting (Pro and above)." });
  } catch (error) {
    if (error instanceof PlanError) return NextResponse.json({ error: error.message }, { status: 402 });
    throw error;
  }
}
