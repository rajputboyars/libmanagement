/**
 * Library modules. Pure and client-safe: used by the server (enforcement) and by the screens (navigation).
 * A module is usable by a library only when ALL of these hold:
 *   1. the platform has not blocked it (globally or for the organization),
 *   2. the subscription includes the plan feature it needs (if any),
 *   3. the library owner has not turned it off,
 *   4. every module it depends on is usable too.
 * Turning a module off never touches its data.
 */
export const MODULES = {
  seats: { name: "Seats & shifts", description: "Seat map, shifts and seat-change requests.", requires: [] as string[] },
  memberships: { name: "Memberships & plans", description: "Fee plans, memberships, renewals, pause and cancel.", requires: ["seats"] },
  fees: { name: "Fees & payments", description: "Record payments, pending fees, receipts and reminders.", requires: ["memberships"] },
  expenses: { name: "Expenses", description: "Track the library's running costs.", requires: [], feature: "fees-expenses" },
  attendance: { name: "Attendance", description: "Punch in and out, live presence and the desk QR code.", requires: [] },
  analytics: { name: "Reports & analytics", description: "Library reports and branch analytics.", requires: [] },
  crm: { name: "Admissions CRM", description: "Enquiries, follow-ups and conversions.", requires: [], feature: "crm" },
  maintenance: { name: "Maintenance", description: "Repair issues and seats taken out of service.", requires: [] },
  waitlist: { name: "Seat waitlist", description: "Waiting list and seat offers.", requires: ["seats"] },
  rewards: { name: "Rewards", description: "Coin rewards students can redeem.", requires: [] },
  events: { name: "Events", description: "Quizzes, workshops and challenges.", requires: [] },
  community: { name: "Community", description: "Study buddies, mentors, success wall and moderation.", requires: [] },
  discovery: { name: "Public listing", description: "Public library page, visit requests and the listing.", requires: [] },
  feedback: { name: "Feedback & complaints", description: "Student feedback, complaints and replies.", requires: [] },
  learning: { name: "Student learning", description: "Exam prep, mock tests, planner, doubt solver and study tools for your students.", requires: [] },
} as const satisfies Record<string, { name: string; description: string; requires: string[]; feature?: string }>;

export type ModuleKey = keyof typeof MODULES;
export const MODULE_KEYS = Object.keys(MODULES) as ModuleKey[];
export const isModuleKey = (k: string): k is ModuleKey => k in MODULES;

export type ModuleReason = "on" | "platform" | "plan" | "library" | "dependency";
export type ModuleState = { enabled: boolean; reason: ModuleReason; needs?: string };

export function resolveModules(input: { platformBlocked?: string[]; libraryDisabled?: string[]; features: string[] }): Record<ModuleKey, ModuleState> {
  const blocked = new Set(input.platformBlocked ?? []), off = new Set(input.libraryDisabled ?? []), have = new Set(input.features);
  const out = {} as Record<ModuleKey, ModuleState>;
  const own = (k: ModuleKey): ModuleState => {
    const def = MODULES[k] as { feature?: string };
    if (blocked.has(k)) return { enabled: false, reason: "platform" };
    if (def.feature && !have.has(def.feature)) return { enabled: false, reason: "plan", needs: def.feature };
    if (off.has(k)) return { enabled: false, reason: "library" };
    return { enabled: true, reason: "on" };
  };
  const done = new Map<ModuleKey, ModuleState>();
  const visit = (k: ModuleKey, stack: string[] = []): ModuleState => {
    const cached = done.get(k);
    if (cached) return cached;
    let state = own(k);
    if (state.enabled && !stack.includes(k))
      for (const dep of MODULES[k].requires as readonly string[]) {
        if (!isModuleKey(dep) || !visit(dep, [...stack, k]).enabled) { state = { enabled: false, reason: "dependency", needs: dep }; break; }
      }
    done.set(k, state);
    return state;
  };
  for (const k of MODULE_KEYS) out[k] = visit(k);
  return out;
}

/** Everything that depends on this module, directly or not: it stops working when this one is off. */
export function dependents(key: ModuleKey): ModuleKey[] {
  const direct = MODULE_KEYS.filter((k) => (MODULES[k].requires as readonly string[]).includes(key));
  return [...new Set(direct.flatMap((k) => [k, ...dependents(k)]))];
}
