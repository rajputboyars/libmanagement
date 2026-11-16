import type { ModuleKey } from "./modules";

/** Library permissions. Keys are stable: they are stored on roles. */
export const PERMISSIONS = {
  "students.view": { module: null, label: "See students" },
  "students.create": { module: null, label: "Add or invite students" },
  "students.approve": { module: null, label: "Approve or reject join requests" },
  "seats.view": { module: "seats", label: "See the seat map and shifts" },
  "seats.create": { module: "seats", label: "Add seats and shifts" },
  "seats.approve": { module: "seats", label: "Approve seat-change requests" },
  "plans.view": { module: "memberships", label: "See fee plans" },
  "memberships.view": { module: "memberships", label: "See memberships" },
  "memberships.create": { module: "memberships", label: "Create plans and memberships" },
  "memberships.update": { module: "memberships", label: "Renew, pause or cancel memberships" },
  "fees.view": { module: "fees", label: "See payments and pending fees" },
  "fees.create": { module: "fees", label: "Record payments and send fee reminders" },
  "fees.reverse": { module: "fees", label: "Reverse a payment (owner decision)", sensitive: true },
  "expenses.view": { module: "expenses", label: "See expenses" },
  "expenses.create": { module: "expenses", label: "Record expenses" },
  "attendance.view": { module: "attendance", label: "See attendance and who is inside" },
  "attendance.mark": { module: "attendance", label: "Mark attendance and punch students out" },
  "attendance.qr": { module: "attendance", label: "Show the desk QR code" },
  "analytics.view": { module: "analytics", label: "See reports and analytics" },
  "crm.view": { module: "crm", label: "See admission enquiries" },
  "crm.manage": { module: "crm", label: "Manage enquiries and follow-ups" },
  "maintenance.view": { module: "maintenance", label: "See maintenance issues" },
  "maintenance.manage": { module: "maintenance", label: "Manage maintenance issues" },
  "waitlist.view": { module: "waitlist", label: "See the seat waitlist" },
  "waitlist.manage": { module: "waitlist", label: "Make seat offers from the waitlist" },
  "rewards.view": { module: "rewards", label: "See rewards" },
  "rewards.manage": { module: "rewards", label: "Manage rewards and redemptions" },
  "events.view": { module: "events", label: "See events" },
  "events.manage": { module: "events", label: "Create and run events" },
  "community.view": { module: "community", label: "See community activity" },
  "community.moderate": { module: "community", label: "Moderate the community" },
  "discovery.view": { module: "discovery", label: "See visit requests" },
  "discovery.manage": { module: "discovery", label: "Manage visit requests and the listing" },
  "feedback.view": { module: "feedback", label: "See feedback and complaints" },
  "feedback.respond": { module: "feedback", label: "Reply to feedback and complaints" },
  "notifications.create": { module: null, label: "Send announcements" },
  "settings.manage": { module: null, label: "Change library settings (hours, holidays)" },
} as const satisfies Record<string, { module: ModuleKey | null; label: string; sensitive?: boolean }>;

export type PermissionKey = keyof typeof PERMISSIONS;
export const PERMISSION_KEYS = Object.keys(PERMISSIONS) as PermissionKey[];
export const isPermission = (k: string): k is PermissionKey => k in PERMISSIONS;
/** Never grantable to staff: billing, staff, roles and module switches stay with the owner. */
export const OWNER_ONLY = ["staff.manage", "billing.manage", "modules.manage"] as const;

const all = PERMISSION_KEYS;
export const PRESET_ROLES: { key: string; name: string; description: string; permissions: PermissionKey[] }[] = [
  { key: "manager", name: "Manager", description: "Runs the library day to day. Everything except reversing payments.", permissions: all.filter((p) => p !== "fees.reverse") },
  { key: "accountant", name: "Accountant", description: "Fees, payments, expenses and reports.", permissions: ["students.view", "plans.view", "memberships.view", "fees.view", "fees.create", "expenses.view", "expenses.create", "analytics.view"] },
  { key: "receptionist", name: "Receptionist", description: "Desk work: students, seats, memberships, attendance and enquiries.", permissions: ["students.view", "students.create", "students.approve", "seats.view", "seats.approve", "plans.view", "memberships.view", "memberships.create", "memberships.update", "attendance.view", "attendance.mark", "crm.view", "crm.manage", "waitlist.view", "waitlist.manage", "feedback.view", "notifications.create"] },
  { key: "attendance", name: "Attendance Staff", description: "Marks attendance and shows the desk QR code.", permissions: ["students.view", "seats.view", "attendance.view", "attendance.mark", "attendance.qr"] },
];

/**
 * Staff created before roles existed carry the old fixed words (attendance, students, payments, expenses).
 * They keep exactly the access they had: a small base (what every staff member could already see or do)
 * plus what each word allowed. Nothing needs to be reconfigured.
 */
export const LEGACY_BASE: PermissionKey[] = [
  "seats.view", "plans.view", "maintenance.view", "maintenance.manage", "rewards.view", "rewards.manage", "waitlist.view", "waitlist.manage",
  "discovery.view", "community.view", "community.moderate", "feedback.view", "feedback.respond", "events.view", "events.manage",
];
export const LEGACY_WORDS: Record<string, PermissionKey[]> = {
  attendance: ["attendance.view", "attendance.mark", "students.view"],
  students: ["students.view", "students.create", "students.approve", "crm.view", "crm.manage", "seats.approve"],
  payments: ["fees.view", "fees.create", "memberships.view", "students.view"],
  expenses: ["expenses.view", "expenses.create"],
};

/** Permissions of a staff member: their role if they have one, otherwise the legacy mapping. Unknown keys are dropped. */
export function staffPermissions(input: { rolePermissions?: string[] | null; legacy?: string[] }): Set<PermissionKey> {
  if (input.rolePermissions) return new Set(input.rolePermissions.filter(isPermission));
  const out = new Set<PermissionKey>(LEGACY_BASE);
  for (const word of input.legacy ?? []) for (const p of LEGACY_WORDS[word] ?? []) out.add(p);
  return out;
}

/** Which module/permission each owner screen needs. A screen with no entry is always shown to owners and staff. */
export const NAV_ACCESS: Record<string, { module?: ModuleKey; permission?: PermissionKey; ownerOnly?: boolean }> = {
  "/owner/students": { permission: "students.view" },
  "/owner/seats": { module: "seats", permission: "seats.view" },
  "/owner/shifts": { module: "seats", permission: "seats.view" },
  "/owner/plans": { module: "memberships", permission: "plans.view" },
  "/owner/memberships": { module: "memberships", permission: "memberships.view" },
  "/owner/fees": { module: "fees", permission: "fees.view" },
  "/owner/payments": { module: "fees", permission: "fees.view" },
  "/owner/attendance": { module: "attendance", permission: "attendance.view" },
  "/owner/presence": { module: "attendance", permission: "attendance.view" },
  "/owner/expenses": { module: "expenses", permission: "expenses.view" },
  "/owner/reports": { module: "analytics", permission: "analytics.view" },
  "/owner/complaints": { module: "feedback", permission: "feedback.view" },
  "/owner/feedback": { module: "feedback", permission: "feedback.view" },
  "/owner/rewards": { module: "rewards", permission: "rewards.view" },
  "/owner/discovery": { module: "discovery", permission: "discovery.view" },
  "/owner/join-requests": { permission: "students.approve" },
  "/owner/waitlist": { module: "waitlist", permission: "waitlist.view" },
  "/owner/crm": { module: "crm", permission: "crm.view" },
  "/owner/events": { module: "events", permission: "events.view" },
  "/owner/maintenance": { module: "maintenance", permission: "maintenance.view" },
  "/owner/moderation": { module: "community", permission: "community.view" },
  "/owner/branches": { ownerOnly: true },
  "/owner/billing": { ownerOnly: true },
  "/owner/onboarding": { ownerOnly: true },
  "/owner/import": { ownerOnly: true },
  "/owner/support": { ownerOnly: true },
  "/owner/team": { ownerOnly: true },
  "/owner/modules": { ownerOnly: true },
};
/** Student screens that belong to the "learning" module. */
export const LEARNING_PATHS = ["/app/roadmap", "/app/prep", "/app/quiz", "/app/revisions", "/app/intelligence", "/app/doubts", "/app/planner", "/app/report", "/app/tracker", "/app/partner", "/app/library-notes", "/app/leaderboard"];
export const STUDENT_PATH_MODULE: Record<string, ModuleKey> = {
  ...Object.fromEntries(LEARNING_PATHS.map((p) => [p, "learning" as ModuleKey])),
  "/app/rewards": "rewards", "/app/community": "community", "/app/friends": "community", "/app/rooms": "community",
  "/app/events": "events", "/app/maintenance": "maintenance", "/app/library-requests": "discovery",
};
