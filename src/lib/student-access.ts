// Premium student features: the platform owner marks some student features as premium; a student gets them only
// while a library membership is active today AND fully paid. Owners, staff and admins are never limited here.

export const STUDENT_FEATURES = {
  "exam-prep": { label: "Exam prep & mock tests", paths: ["/app/roadmap", "/app/prep", "/app/quiz"] },
  learning: { label: "Smart revision & learning insights", paths: ["/app/revisions", "/app/intelligence"] },
  doubts: { label: "Doubt solver", paths: ["/app/doubts"] },
  planner: { label: "Study planner", paths: ["/app/planner"] },
  "weekly-report": { label: "Weekly report card", paths: ["/app/report"] },
  social: { label: "Friends, focus rooms & community", paths: ["/app/friends", "/app/rooms", "/app/community"] },
  rewards: { label: "Rewards marketplace", paths: ["/app/rewards"] },
  garden: { label: "Study garden", paths: ["/app/garden"] },
} as const;
export type StudentFeature = keyof typeof STUDENT_FEATURES;
export const isStudentFeature = (k: string): k is StudentFeature => k in STUDENT_FEATURES;

/** Which student feature a page belongs to, if any. */
export function studentFeatureForPath(path: string): StudentFeature | null {
  for (const [key, f] of Object.entries(STUDENT_FEATURES)) if ((f.paths as readonly string[]).includes(path)) return key as StudentFeature;
  return null;
}

export type MembershipLike = { start: Date | string; end: Date | string; status?: string; amount?: number; discount?: number; paid?: number };

/** Paid up = at least one membership that is active today with nothing left to pay. */
export function paidUpStatus(memberships: MembershipLike[], now = new Date()) {
  const current = memberships.filter((m) => (m.status ?? "active") === "active" && +new Date(m.start) <= +now && +new Date(m.end) > +now);
  if (!current.length) return { paidUp: false, reason: "no-membership" as const, duePaise: 0 };
  const due = Math.min(...current.map((m) => Math.max(0, (m.amount ?? 0) - (m.discount ?? 0) - (m.paid ?? 0))));
  return due > 0 ? { paidUp: false, reason: "dues" as const, duePaise: due } : { paidUp: true, reason: "paid" as const, duePaise: 0 };
}

export type StudentAccess = { paidUp: boolean; reason: "paid" | "dues" | "no-membership" | "not-student"; duePaise: number; premium: StudentFeature[]; locked: StudentFeature[] };

/** Pure: which premium features are locked for this student. */
export function resolveStudentAccess(premium: string[], memberships: MembershipLike[], now = new Date()): StudentAccess {
  const status = paidUpStatus(memberships, now);
  const list = premium.filter(isStudentFeature);
  return { ...status, premium: list, locked: status.paidUp ? [] : list };
}

export const lockedMessage = (reason: StudentAccess["reason"]) =>
  reason === "dues"
    ? "This is a premium feature. Clear your library fees to unlock it."
    : "This is a premium feature for students with an active, paid library membership.";
