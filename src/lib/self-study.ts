// Pure self-study logic (unit-tested): focus quality, heatmap, plans, goals, reflections, chapters, month compare.
import { libraryClock } from "./library-hours";

/** 100% minus 8 points per time the student left the app, never below 0. */
export const focusQuality = (distractions: number) => Math.max(0, 100 - 8 * Math.max(0, distractions));

/** India date (YYYY-MM-DD) of a moment. */
export const istDay = (d: Date | string) => libraryClock(new Date(d)).date;

/** Last `days` India dates ending today with study minutes on each (for the heatmap). */
export function heatmap(sessions: { completedAt: Date | string; activeSeconds: number }[], now = new Date(), days = 365) {
  const today = Date.parse(`${libraryClock(now).date}T00:00:00Z`);
  const dates = Array.from({ length: days }, (_, i) => new Date(today - (days - 1 - i) * 86400000).toISOString().slice(0, 10));
  const minutes = new Map(dates.map((d) => [d, 0]));
  for (const s of sessions) {
    const d = istDay(s.completedAt);
    if (minutes.has(d)) minutes.set(d, (minutes.get(d) ?? 0) + s.activeSeconds / 60);
  }
  return dates.map((date) => ({ date, minutes: Math.round(minutes.get(date) ?? 0) }));
}

/** Heat level 0–4 for a day's minutes. */
export const heatLevel = (minutes: number) => (minutes <= 0 ? 0 : minutes < 60 ? 1 : minutes < 150 ? 2 : minutes < 300 ? 3 : 4);

/** Minutes per subject, biggest first ("Untagged" for sessions without a subject). */
export function bySubject(sessions: { subject?: string; activeSeconds: number }[]) {
  const map = new Map<string, number>();
  for (const s of sessions) {
    const key = s.subject?.trim() || "Untagged";
    map.set(key, (map.get(key) ?? 0) + s.activeSeconds / 60);
  }
  return [...map].map(([subject, m]) => ({ subject, minutes: Math.round(m) })).sort((a, b) => b.minutes - a.minutes);
}

/** Share of planned tasks that were done, over finished days (null when nothing was planned). */
export function planKeptRate(plans: { tasks: { done: boolean }[] }[]) {
  const tasks = plans.flatMap((p) => p.tasks);
  return tasks.length ? Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100) : null;
}

export const CHAPTER_STEPS = ["read", "notes", "rev1", "rev2", "pyq"] as const;
export type ChapterSteps = Partial<Record<(typeof CHAPTER_STEPS)[number], boolean>>;
/** A chapter is complete when all 5 steps are ticked; percent counts steps. */
export const stepsDone = (s?: ChapterSteps | null) => CHAPTER_STEPS.filter((k) => s?.[k]).length;
export const chapterComplete = (s?: ChapterSteps | null) => stepsDone(s) === CHAPTER_STEPS.length;

/** On track when the share of finished chapters keeps up with the share of time used. */
export function goalStatus(done: number, total: number, createdAt: Date, deadline: Date, now = new Date()) {
  const progress = total ? done / total : 0;
  const span = Math.max(1, +deadline - +createdAt);
  const used = Math.min(1, Math.max(0, (+now - +createdAt) / span));
  const daysLeft = Math.ceil((+deadline - +now) / 86400000);
  const state = progress >= 1 ? "done" : daysLeft < 0 ? "missed" : progress + 0.001 >= used ? "on-track" : "behind";
  return { percent: Math.round(progress * 100), timeUsed: Math.round(used * 100), daysLeft, state } as const;
}

/** "You study X% more on high-energy days" (energy 4–5 vs 1–2); null without enough data. */
export function energyPattern(reflections: { day: string; energy: number }[], minutesByDay: Map<string, number>) {
  const avg = (days: string[]) => days.reduce((n, d) => n + (minutesByDay.get(d) ?? 0), 0) / days.length;
  const high = reflections.filter((r) => r.energy >= 4).map((r) => r.day);
  const low = reflections.filter((r) => r.energy <= 2).map((r) => r.day);
  if (high.length < 2 || low.length < 2) return null;
  const h = avg(high), l = avg(low);
  if (l <= 0) return h > 0 ? { highMinutes: Math.round(h), lowMinutes: 0, morePercent: null } : null;
  return { highMinutes: Math.round(h), lowMinutes: Math.round(l), morePercent: Math.round(((h - l) / l) * 100) };
}

/** Change from last month to this month, in percent (null when last month was 0). */
export const change = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

/** A mistake is fixed after 2 correct retries in a row. */
export const fixedByRetries = (retries: { correct: boolean }[]) => retries.length >= 2 && retries.slice(-2).every((r) => r.correct);
