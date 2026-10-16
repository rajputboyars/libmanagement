import { CommunityBlock, CommunityProfile, StudentProfile, StudySession, XPTransaction } from "./models";
import { level, streak } from "./rules";
import { earnedRungs, MILESTONE_TYPES, type MilestoneType } from "./community";

type ProfileLike = { optedIn?: boolean; moderation?: string; consentStatus?: string } | null | undefined;

/** A member may interact only when opted in, not suspended, and (for minors) guardian-approved. */
export const mayInteract = (profile: ProfileLike) =>
  !!profile && !!profile.optedIn && profile.moderation === "active" && ["not-required", "approved"].includes(String(profile.consentStatus));

export async function blockedBetween(userId: unknown) {
  const rows = await CommunityBlock.find({ $or: [{ userId }, { blockedId: userId }] }).lean();
  return new Set(rows.map((row) => String(String(row.userId) === String(userId) ? row.blockedId : row.userId)));
}

export async function verifiedStats(userId: unknown) {
  const [sessions, xp, profile] = await Promise.all([
    StudySession.find({ userId, state: "complete" }).select("activeSeconds completedAt").lean(),
    XPTransaction.aggregate([{ $match: { userId, amount: { $gt: 0 } } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    StudentProfile.findOne({ userId }).select("restDays").lean<{ restDays?: string[] }>(),
  ]);
  const seconds = sessions.reduce((sum, session) => sum + Number(session.activeSeconds || 0), 0);
  const days = [...new Set(sessions.filter((s) => s.completedAt).map((s) => new Date(s.completedAt as Date).toISOString().slice(0, 10)))];
  const stats: Record<MilestoneType, number> = {
    "focus-hours": Math.floor(seconds / 3600),
    level: level(xp[0]?.total || 0),
    streak: streak(days, new Date().toISOString().slice(0, 10), (profile?.restDays as string[] | undefined) || []),
  };
  return { stats, rungs: Object.fromEntries(MILESTONE_TYPES.map((type) => [type, earnedRungs(type, stats[type])])) as Record<MilestoneType, number[]> };
}

type PostLike = { userId: unknown; libraryId: unknown; visibility: string; status: string };
export async function canViewPost(post: PostLike, viewer: { _id: unknown; libraryId?: unknown }) {
  if (String(post.userId) === String(viewer._id)) return true;
  if (post.status !== "published" || post.visibility === "private") return false;
  const [mine, author, blocked] = await Promise.all([
    CommunityProfile.findOne({ userId: viewer._id }).lean<ProfileDoc>(),
    CommunityProfile.findOne({ userId: post.userId }).lean<ProfileDoc>(),
    blockedBetween(viewer._id),
  ]);
  if (!mayInteract(mine) || !mayInteract(author) || blocked.has(String(post.userId))) return false;
  if (post.visibility === "public") return author?.ageBand === "adult";
  return String(post.libraryId) === String(viewer.libraryId);
}

export type ProfileDoc = { userId: unknown; libraryId: unknown; alias: string; optedIn: boolean; ageBand: "adult" | "minor"; consentStatus: string; moderation: string; lookingForBuddy: boolean; mentorship: string; sharedGoal: string };
export type PostDoc = PostLike & { _id: unknown; milestoneType: string; milestoneValue: number; message: string; createdAt: Date };
export type ExamDoc = { examKey: string; weeklyMinutes: number; subjectIds?: unknown[] };
