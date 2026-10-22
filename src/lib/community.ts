export const AGE_BANDS = ["adult", "minor"] as const;
export const MENTORSHIP = ["none", "seeking", "offering"] as const;
export const VISIBILITY = ["private", "library", "public"] as const;
export const REPORT_REASONS = ["harassment", "unsafe-contact", "inappropriate", "spam", "privacy", "other"] as const;
export const MILESTONE_TYPES = ["focus-hours", "level", "streak"] as const;
export type MilestoneType = (typeof MILESTONE_TYPES)[number];

export const LADDERS: Record<MilestoneType, number[]> = {
  "focus-hours": [5, 10, 25, 50, 100, 250, 500],
  level: [2, 5, 10, 15, 20, 30],
  streak: [3, 7, 14, 30, 60, 100],
};

/** Rejects emails, links, handles and phone-like digit runs so free text cannot leak contact details. */
export function containsContactInfo(text: string) {
  const compact = text.replace(/[\s().-]/g, "");
  return (
    /[^\s@]+@[^\s@]+/.test(text) ||
    /https?:\/\/|www\.|\.[a-z]{2,}\/|\b[a-z0-9-]+\.(com|in|me|io|net|org)\b/i.test(text) ||
    /(^|\s)@\w{3,}/.test(text) ||
    /\d{8,}/.test(compact) ||
    /\b(whatsapp|telegram|instagram|snapchat|insta)\b/i.test(text)
  );
}

export function minorsMayUse(visibility: string) {
  return visibility !== "public";
}

/** Highest earned rung of a ladder for a verified value, or null. */
export function earnedRungs(type: MilestoneType, actual: number) {
  return LADDERS[type].filter((rung) => actual >= rung);
}

export function headline(type: MilestoneType, value: number) {
  if (type === "focus-hours") return `${value} hours of verified focus`;
  if (type === "level") return `Reached level ${value}`;
  return `${value}-day study streak`;
}

export function pairKey(kind: "buddy" | "mentorship", a: string, b: string) {
  return kind === "buddy" ? `buddy:${[a, b].sort().join(":")}` : `mentorship:${a}:${b}`;
}

export type MatchCandidate = { userId: string; examKey: string; weeklyMinutes: number; sharedSubjects: number; sameShift?: boolean };
/** Deterministic buddy score: same shift in the library, a closer weekly target and more shared subjects rank higher. */
export function buddyScore(self: { weeklyMinutes: number }, other: MatchCandidate) {
  const gap = Math.abs(self.weeklyMinutes - other.weeklyMinutes) / Math.max(self.weeklyMinutes, other.weeklyMinutes, 1);
  return Math.round((1 - gap) * 60) + other.sharedSubjects * 10 + (other.sameShift ? 25 : 0);
}

export const xml = (value: string) => value.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
