import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Membership, Payment, User } from "@/lib/models";
import { DataRequest } from "@/lib/ops-models";
import { SupportTicket } from "@/lib/saas-models";
import { audit, ensureOrganizationForLibrary } from "@/lib/saas-server";
import { log } from "@/lib/log";

const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const M = (name: string) => mongoose.models[name];

/** Personal learning data: exported on request and erased on account deletion. Financial and operational library records are kept, anonymised. */
const USER_DATA: [string, string][] = [
  ["StudentProfile", "userId"], ["StudySession", "userId"], ["XPTransaction", "userId"], ["StudyGoal", "userId"], ["StudentAchievement", "userId"], ["QuestProgress", "userId"],
  ["StudentExam", "userId"], ["TopicProgress", "userId"], ["StudyPlan", "userId"], ["PlanTask", "userId"], ["QuizAttempt", "userId"], ["RevisionSchedule", "userId"], ["WeeklyLearningInsight", "userId"],
  ["LearningAudit", "userId"], ["Doubt", "userId"], ["AIUsage", "userId"], ["CoinTransaction", "userId"], ["StudentGarden", "userId"], ["GardenTransaction", "userId"], ["RoomParticipant", "userId"],
  ["EventRegistration", "userId"], ["TestAttempt", "userId"], ["TestAnswer", "userId"], ["MistakeEntry", "userId"], ["Flashcard", "userId"], ["StudentNote", "userId"], ["ExamGoal", "userId"],
  ["CommunityProfile", "userId"], ["CommunityBlock", "userId"], ["SuccessPost", "userId"], ["Notification", "userId"], ["LibraryVisitRequest", "userId"], ["SeatWaitlist", "userId"], ["OnboardingDraft", "userId"],
];
const EITHER_SIDE: [string, string, string][] = [["Friendship", "requesterId", "recipientId"], ["CommunityLink", "fromId", "toId"]];

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`privacy:${user._id}`, 5)) return err("Please slow down", 429);
  const data: Record<string, unknown> = { exportedAt: new Date().toISOString(), account: { name: user.name, email: user.email, role: user.role } };
  for (const [name, field] of USER_DATA) {
    const model = M(name);
    if (!model) continue;
    const rows = await model.find({ [field]: user._id }).limit(5000).lean();
    if (rows.length) data[name] = name === "Doubt" ? rows.map((r: Record<string, unknown>) => ({ ...r, image: r.image ? "[image omitted]" : undefined })) : rows;
  }
  if (user.role === "student") {
    data.memberships = await Membership.find({ userId: user._id }).lean();
    data.payments = await Payment.find({ userId: user._id }).select("-key").lean();
  }
  await DataRequest.create({ userId: user._id, kind: "export", status: "completed", completedAt: new Date() });
  if (request.nextUrl.searchParams.get("download") === "1")
    return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json", "Content-Disposition": 'attachment; filename="studyquest-my-data.json"', "Cache-Control": "private, no-store" } });
  return NextResponse.json({ ok: true, sections: Object.keys(data) });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`privacy-post:${user._id}`, 5)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.enum(["delete-account", "request-organization-deletion"]), password: z.string().min(1).max(100), confirm: z.literal("DELETE") }).parse(await request.json());
    const full = await User.findById(user._id).select("+passwordHash");
    if (!full || !(await bcrypt.compare(body.password, full.passwordHash))) return err("Your password is not correct");
    if (body.action === "request-organization-deletion") {
      if (user.role !== "owner" || !user.libraryId) return err("Only organization owners can request this", 403);
      const orgId = await ensureOrganizationForLibrary(user.libraryId);
      await DataRequest.create({ userId: user._id, organizationId: orgId, kind: "delete-organization", status: "pending", note: "Awaiting platform review" });
      await SupportTicket.create({ organizationId: orgId, libraryId: user.libraryId, createdBy: user._id, subject: "Organization data deletion request", category: "account", priority: "high", messages: [{ authorId: user._id, role: "owner", body: "I request deletion of my organization and its data. Please confirm retention obligations (invoices) and next steps.", at: new Date() }], history: [{ status: "open", by: user._id, at: new Date() }] });
      await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "privacy.org-deletion-requested" });
      return NextResponse.json({ ok: true, message: "Request received. A platform administrator will contact you; billing records may need to be retained by law." });
    }
    if (user.role !== "student") return err("Library team accounts are removed by the organization owner or via a deletion request", 403);
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        for (const [name, field] of USER_DATA) await M(name)?.deleteMany({ [field]: user._id }, { session });
        for (const [name, a, b] of EITHER_SIDE) await M(name)?.deleteMany({ $or: [{ [a]: user._id }, { [b]: user._id }] }, { session });
        // Library fee, membership and attendance records stay for the library's accounts, attached to an anonymous account.
        await User.updateOne({ _id: user._id }, { name: "Deleted user", email: `deleted+${user._id}@deleted.invalid`, passwordHash: await bcrypt.hash(String(user._id) + Date.now(), 10), deletedAt: new Date(), $inc: { sessionVersion: 1 }, $unset: { libraryId: 1 } }, { session });
        await DataRequest.create([{ userId: user._id, kind: "delete-account", status: "completed", completedAt: new Date() }], { session });
      });
    } finally { await session.endSession(); }
    log("info", "privacy.account_deleted", { userId: String(user._id) });
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("sq-session");
    return response;
  } catch (error) {
    return err(error instanceof z.ZodError ? 'Type DELETE and your password to confirm' : error instanceof Error ? error.message : "Unable to complete the request", 400);
  }
}
