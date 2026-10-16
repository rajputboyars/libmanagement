import { NextRequest, NextResponse } from "next/server";
import { currentUser, limited } from "@/lib/auth";
import { Expense, Membership, Payment, User } from "@/lib/models";
import { AdmissionLead } from "@/lib/saas-models";
import { audit, ensureOrganizationForLibrary, verifyOrgOwner } from "@/lib/saas-server";

const cell = (v: unknown) => {
  const s = v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formula injection
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const SOURCES = {
  students: { find: (libraryId: unknown) => User.find({ role: "student", libraryId }).select("name email createdAt"), cols: ["name", "email", "createdAt"] },
  memberships: { find: (libraryId: unknown) => Membership.find({ libraryId }), cols: ["userId", "planId", "start", "end", "amount", "discount", "paid", "status"] },
  payments: { find: (libraryId: unknown) => Payment.find({ libraryId }), cols: ["membershipId", "amount", "method", "receipt", "createdAt"] },
  expenses: { find: (libraryId: unknown) => Expense.find({ libraryId }), cols: ["title", "category", "amount", "date"] },
  leads: { find: (libraryId: unknown) => AdmissionLead.find({ libraryId }), cols: ["name", "phone", "email", "source", "stage", "consentContact", "createdAt"] },
} as const;

/** Data export stays available on every plan, including after expiry or suspension: operational data is never held hostage. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "owner" || !user.libraryId) return NextResponse.json({ error: "Owner access required" }, { status: 403 });
  if (limited(`export:${user._id}`, 10)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  const resource = request.nextUrl.searchParams.get("resource") as keyof typeof SOURCES;
  const source = SOURCES[resource];
  if (!source) return NextResponse.json({ error: "Unknown export" }, { status: 404 });
  const orgId = await verifyOrgOwner(user);
  const rows = await source.find(user.libraryId).limit(50000).lean<Record<string, unknown>[]>();
  const csv = [source.cols.join(","), ...rows.map((r) => source.cols.map((c) => cell(r[c])).join(","))].join("\n");
  await ensureOrganizationForLibrary(user.libraryId);
  await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "data.export", details: { resource, rows: rows.length } });
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="studyquest-${resource}.csv"`, "Cache-Control": "private, no-store" } });
}
