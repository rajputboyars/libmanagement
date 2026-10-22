// Server side of premium student features (see student-access.ts for the rules).
import { Membership } from "./models";
import { PlatformSettings } from "./saas-models";
import { lockedMessage, resolveStudentAccess, type StudentAccess, type StudentFeature } from "./student-access";

export async function premiumStudentFeatures(): Promise<string[]> {
  const s = await PlatformSettings.findOne({ key: "default" }).select("premiumStudentFeatures").lean<{ premiumStudentFeatures?: string[] }>();
  return s?.premiumStudentFeatures ?? [];
}

export async function studentAccessFor(user: { _id: unknown; role: string }, now = new Date()): Promise<StudentAccess> {
  if (user.role !== "student") return { paidUp: true, reason: "not-student", duePaise: 0, premium: [], locked: [] };
  const premium = await premiumStudentFeatures();
  if (!premium.length) return { paidUp: true, reason: "paid", duePaise: 0, premium: [], locked: [] };
  const memberships = await Membership.find({ userId: user._id, end: { $gt: now } })
    .select("start end status amount discount paid")
    .lean<{ start: Date; end: Date; status?: string; amount?: number; discount?: number; paid?: number }[]>();
  return resolveStudentAccess(premium, memberships, now);
}

export class StudentFeatureError extends Error {
  status = 402;
  code = "premium";
}

/** Throws when this student may not use the feature right now. */
export async function requireStudentFeature(user: { _id: unknown; role: string }, feature: StudentFeature) {
  const access = await studentAccessFor(user);
  if (access.locked.includes(feature)) throw new StudentFeatureError(lockedMessage(access.reason));
}

/** For API routes: a 402 response when a student may not use this feature, otherwise null. */
export async function studentFeatureBlocked(user: { _id: unknown; role: string } | null, feature: StudentFeature) {
  if (!user || user.role !== "student") return null;
  const access = await studentAccessFor(user);
  if (!access.locked.includes(feature)) return null;
  const { NextResponse } = await import("next/server");
  return NextResponse.json({ error: lockedMessage(access.reason), code: "premium" }, { status: 402 });
}
