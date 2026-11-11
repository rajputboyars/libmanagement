export type Role = "owner" | "student" | "admin";

/**
 * Preferred primary destinations per role, in priority order. They are matched against the
 * already module/permission-filtered nav, so a missing one (turned off or not allowed) is skipped
 * and the next candidate or nav item takes its place. Mobile shows the first 4, the tablet rail the first 7.
 */
export const PRIMARY_NAV: Record<Role, string[]> = {
  owner: ["/owner", "/owner/students", "/owner/seats", "/owner/fees", "/owner/attendance", "/owner/payments", "/owner/reports"],
  student: ["/app", "/app/punch", "/app/membership", "/app/focus", "/app/prep", "/app/quests", "/app/progress"],
  admin: ["/super-admin", "/super-admin/libraries", "/super-admin/subscriptions", "/super-admin/plans", "/super-admin/modules", "/super-admin/accounts", "/super-admin/business"],
};
export const MOBILE_PRIMARY_COUNT = 4;
export const RAIL_PRIMARY_COUNT = 7;

/** First `count` items of `nav`: configured candidates first (in order), then any remaining nav items. Never invents an item. */
export function pickPrimary<T extends [string, string, unknown]>(nav: T[], candidates: string[], count: number): T[] {
  const byHref = new Map<string, T>(nav.map((n) => [n[0], n]));
  const picked: T[] = [];
  for (const href of candidates) {
    const hit = byHref.get(href);
    if (hit) picked.push(hit);
  }
  for (const item of nav) if (picked.length < count && !picked.includes(item)) picked.push(item);
  return picked.slice(0, count);
}

export type NavGroup = { label: string; hrefs: string[] };
/**
 * Information architecture per role. Groups only reorder and label the already-filtered nav:
 * an href that is missing from the nav (module off, no permission) simply does not appear, and any nav item
 * not listed here still shows up under "Other", so a new route can never be hidden by this config.
 */
export const NAV_GROUPS: Partial<Record<Role, NavGroup[]>> = {
  admin: [
    { label: "", hrefs: ["/super-admin"] },
    { label: "Business", hrefs: ["/super-admin/libraries", "/super-admin/subscriptions", "/super-admin/plans", "/super-admin/business", "/super-admin/analytics"] },
    { label: "Platform controls", hrefs: ["/super-admin/modules", "/super-admin/features", "/super-admin/student-features", "/super-admin/accounts"] },
    { label: "Content", hrefs: ["/super-admin/syllabus", "/super-admin/question-bank"] },
  ],
  student: [
    { label: "", hrefs: ["/app"] },
    { label: "My library", hrefs: ["/app/punch", "/app/membership", "/app/join", "/app/library-requests", "/app/library-notes", "/app/maintenance", "/app/events"] },
    { label: "Study", hrefs: ["/app/focus", "/app/planner", "/app/roadmap", "/app/tracker", "/app/prep", "/app/intelligence", "/app/revisions", "/app/doubts", "/app/quiz", "/app/report", "/app/progress", "/app/quests", "/app/achievements"] },
    { label: "Community", hrefs: ["/app/partner", "/app/friends", "/app/rooms", "/app/community", "/app/leaderboard", "/app/garden", "/app/share", "/app/rewards"] },
    { label: "Account", hrefs: ["/app/security"] },
  ],
  owner: [
    { label: "", hrefs: ["/owner"] },
    { label: "People", hrefs: ["/owner/students", "/owner/join-requests", "/owner/waitlist", "/owner/crm"] },
    { label: "Library", hrefs: ["/owner/seats", "/owner/shifts", "/owner/attendance", "/owner/presence", "/owner/maintenance"] },
    { label: "Money", hrefs: ["/owner/fees", "/owner/payments", "/owner/memberships", "/owner/plans", "/owner/expenses", "/owner/reports"] },
    { label: "Community", hrefs: ["/owner/complaints", "/owner/feedback", "/owner/events", "/owner/rewards", "/owner/discovery", "/owner/moderation"] },
    { label: "Manage", hrefs: ["/owner/team", "/owner/modules", "/owner/branches", "/owner/billing", "/owner/import", "/owner/onboarding", "/owner/support", "/owner/security", "/owner/settings"] },
  ],
};

export function groupNav<T extends [string, string, unknown]>(nav: T[], groups?: NavGroup[]): { label: string; items: T[] }[] {
  if (!groups) return [{ label: "", items: nav }];
  const byHref = new Map<string, T>(nav.map((n) => [n[0], n]));
  const used = new Set<string>();
  const out = groups
    .map((g) => ({
      label: g.label,
      items: g.hrefs.flatMap((h) => {
        const hit = byHref.get(h);
        if (!hit) return [];
        used.add(h);
        return [hit];
      }),
    }))
    .filter((g) => g.items.length);
  const rest = nav.filter((n) => !used.has(n[0]));
  if (rest.length) out.push({ label: out.length ? "Other" : "", items: rest });
  return out;
}
