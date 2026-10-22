export const XP = {
  focus: 10,
  goal: 20,
  revision: 10,
  weekly: 50,
  dailyCap: 100,
};
export function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
) {
  return a.start < b.end && b.start < a.end;
}
export function price(amount: number, discount: number, paid: number) {
  if (
    [amount, discount, paid].some((v) => !Number.isFinite(v) || v < 0) ||
    discount > amount ||
    paid > amount - discount
  )
    throw new Error("Invalid amounts");
  return {
    total: amount - discount,
    due: amount - discount - paid,
    status: paid === amount - discount ? "paid" : paid ? "partial" : "unpaid",
  };
}
export function reward(current: number, requested: number) {
  return Math.max(0, Math.min(requested, XP.dailyCap - current));
}
export function level(xp: number) {
  return Math.floor(Math.sqrt(xp / 50)) + 1;
}
export function activeSeconds(
  session: { state: string; activeSeconds: number; lastResumedAt: Date },
  now = new Date(),
) {
  return (
    session.activeSeconds +
    (session.state === "running"
      ? Math.max(0, Math.floor((+now - +session.lastResumedAt) / 1000))
      : 0)
  );
}
/** Focus session lengths a student can choose, in minutes. 25 is the default. */
export const FOCUS_LENGTHS = [25, 45, 60] as const;
export type FocusLength = (typeof FOCUS_LENGTHS)[number];
export const focusLength = (minutes: unknown): FocusLength =>
  FOCUS_LENGTHS.includes(minutes as FocusLength) ? (minutes as FocusLength) : 25;
/** XP scales with length (10 XP per 25 minutes): 25 → 10, 45 → 18, 60 → 24. The daily cap still applies. */
export const focusXP = (minutes: number) => Math.round((focusLength(minutes) * XP.focus) / 25);
/** Suggested break after a session: 5 minutes, or 10 after 45+ minutes. */
export const breakMinutes = (minutes: number) => (focusLength(minutes) >= 45 ? 10 : 5);
export function canComplete(
  session: { state: string; activeSeconds: number; lastResumedAt: Date; targetMinutes?: number },
  now = new Date(),
) {
  return (
    session.state !== "complete" &&
    activeSeconds(session, now) >= focusLength(session.targetMinutes) * 60
  );
}
export function streak(days: string[], today: string, rests: string[] = []) {
  const active = new Set(days);
  const resting = new Set(rests);
  let count = 0;
  const date = new Date(`${today}T00:00:00Z`);
  if (!active.has(today) && !resting.has(today))
    date.setUTCDate(date.getUTCDate() - 1);
  for (let i = 0; i < 3660; i++) {
    const key = date.toISOString().slice(0, 10);
    if (active.has(key)) count++;
    else if (!resting.has(key)) break;
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return count;
}
