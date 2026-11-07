export type Role = "owner" | "student" | "admin";

/**
 * Preferred primary destinations per role, in priority order. They are matched against the
 * already module/permission-filtered nav, so a missing one (turned off or not allowed) is skipped
 * and the next candidate or nav item takes its place. Mobile shows the first 4, the tablet rail the first 7.
 */
export const PRIMARY_NAV: Record<Role, string[]> = {
  owner: ["/owner", "/owner/students", "/owner/seats", "/owner/fees", "/owner/attendance", "/owner/payments", "/owner/reports"],
  student: ["/app", "/app/punch", "/app/membership", "/app/quests", "/app/progress", "/app/focus", "/app/prep"],
  admin: ["/super-admin", "/super-admin/libraries", "/super-admin/subscriptions", "/super-admin/analytics", "/super-admin/business", "/super-admin/plans", "/super-admin/modules"],
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
