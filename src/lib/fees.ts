/** Fee figures. Amounts are whatever the library stores (the app saves them as paise); nothing here converts units. */
export type Figures = { status?: string; end: Date | string; amount: number; discount?: number; paid?: number };

export const owed = (m: Figures) => Math.max(0, m.amount - (m.discount ?? 0) - (m.paid ?? 0));
/** Money can only be owed on a membership that is still running: active or paused, and not yet ended. */
export const isRunning = (m: Figures, now = new Date()) => ["active", "paused"].includes(m.status ?? "active") && +new Date(m.end) > +now;

export function feeTotals(memberships: Figures[], now = new Date()) {
  let pending = 0, closedBalance = 0, billed = 0, paid = 0;
  for (const m of memberships) {
    if (m.status === "cancelled") continue; // cancelled memberships are not billed
    billed += m.amount - (m.discount ?? 0);
    paid += m.paid ?? 0;
    if (isRunning(m, now)) pending += owed(m);
    else closedBalance += owed(m); // ended with a balance: shown to the owner, never added to pending
  }
  return { pending, closedBalance, billed, paid };
}

/** Mongo expressions that mirror owed()/isRunning(), so the database and the helpers above agree. */
export const owedExpr = { $max: [0, { $subtract: [{ $subtract: ["$amount", { $ifNull: ["$discount", 0] }] }, { $ifNull: ["$paid", 0] }] }] };
export const runningExpr = (now: Date) => ({ $and: [{ $in: ["$status", ["active", "paused"]] }, { $gt: ["$end", now] }] });

/** Renewal price: the previous discount carries over unless the owner gives a new one; it can never exceed the plan price. */
export function renewalTerms(plan: { amount: number }, previousDiscount: number | undefined, requested?: number) {
  const discount = requested ?? Math.min(previousDiscount ?? 0, plan.amount);
  if (!Number.isInteger(discount) || discount < 0 || discount > plan.amount) throw new Error("Discount exceeds plan price");
  return { discount, payable: plan.amount - discount };
}
