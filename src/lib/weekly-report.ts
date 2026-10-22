// Weekly report card: a 7-day summary a student can share with parents through a private, expiring link.
import { randomBytes } from "node:crypto";
import { Attendance, Library, ReportShare, StudentProfile, StudySession, TestAttempt, User, XPTransaction } from "./models";
import { streak } from "./rules";

export type WeeklyReport = {
  name: string;
  library: string | null;
  from: string;
  to: string;
  days: { date: string; minutes: number }[];
  focusMinutes: number;
  sessions: number;
  visits: number;
  xp: number;
  streak: number;
  tests: number;
  avgScore: number | null;
  goalMinutes: number;
  goalDays: number;
};

/** The last 7 dates (UTC, same as the XP ledger), oldest first, ending today. */
export function weekDates(now = new Date()) {
  return Array.from({ length: 7 }, (_, i) => new Date(+now - (6 - i) * 86400000).toISOString().slice(0, 10));
}

/** Pure part: turns raw rows into the report numbers (unit-tested). */
export function summarize(input: {
  dates: string[];
  sessions: { completedAt: Date; activeSeconds: number }[];
  visitDays: string[];
  xp: { day: string; amount: number; source: string }[];
  allFocusDays: string[];
  restDays: string[];
  tests: { percent?: number | null }[];
  goalMinutes: number;
}) {
  const minutesByDay = new Map(input.dates.map((d) => [d, 0]));
  for (const s of input.sessions) {
    const d = s.completedAt.toISOString().slice(0, 10);
    if (minutesByDay.has(d)) minutesByDay.set(d, (minutesByDay.get(d) ?? 0) + Math.round(s.activeSeconds / 60));
  }
  const days = input.dates.map((date) => ({ date, minutes: minutesByDay.get(date) ?? 0 }));
  const scored = input.tests.map((t) => t.percent).filter((p): p is number => typeof p === "number");
  return {
    days,
    focusMinutes: days.reduce((n, d) => n + d.minutes, 0),
    sessions: input.sessions.length,
    visits: new Set(input.visitDays.filter((d) => input.dates.includes(d))).size,
    xp: input.xp.filter((x) => input.dates.includes(x.day)).reduce((n, x) => n + x.amount, 0),
    streak: streak(input.allFocusDays, input.dates[input.dates.length - 1], input.restDays),
    tests: input.tests.length,
    avgScore: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null,
    goalMinutes: input.goalMinutes,
    goalDays: days.filter((d) => d.minutes >= input.goalMinutes).length,
  };
}

export async function buildWeeklyReport(userId: unknown, now = new Date()): Promise<WeeklyReport> {
  const dates = weekDates(now);
  const since = new Date(`${dates[0]}T00:00:00.000Z`);
  const user = await User.findById(userId).select("name libraryId").lean<{ name: string; libraryId?: unknown }>();
  const [sessions, attendance, xp, focusXp, profile, tests, library] = await Promise.all([
    StudySession.find({ userId, state: "complete", completedAt: { $gte: since } }).select("completedAt activeSeconds").lean<{ completedAt: Date; activeSeconds: number }[]>(),
    Attendance.find({ userId, day: { $gte: dates[0] } }).select("day").lean<{ day: string }[]>(),
    XPTransaction.find({ userId, day: { $gte: dates[0] } }).select("day amount source").lean<{ day: string; amount: number; source: string }[]>(),
    XPTransaction.find({ userId, source: /^focus:/ }).select("day").sort({ day: -1 }).limit(400).lean<{ day: string }[]>(),
    StudentProfile.findOne({ userId }).select("goalMinutes restDays").lean<{ goalMinutes?: number; restDays?: string[] }>(),
    TestAttempt.find({ userId, state: "submitted", submittedAt: { $gte: since } }).select("result.percent").lean<{ result?: { percent?: number } }[]>(),
    user?.libraryId ? Library.findById(user.libraryId).select("name").lean<{ name: string }>() : null,
  ]);
  return {
    name: (user?.name ?? "Student").split(" ")[0],
    library: library?.name ?? null,
    from: dates[0],
    to: dates[6],
    ...summarize({
      dates,
      sessions,
      visitDays: attendance.map((a) => a.day),
      xp,
      allFocusDays: focusXp.map((x) => x.day),
      restDays: profile?.restDays ?? [],
      tests: tests.map((t) => ({ percent: t.result?.percent })),
      goalMinutes: profile?.goalMinutes ?? 120,
    }),
  };
}

/** Saves a snapshot and returns its token. Only the snapshot is ever shown on the public link. */
export async function shareWeeklyReport(userId: unknown, now = new Date()) {
  const report = await buildWeeklyReport(userId, now);
  const token = randomBytes(18).toString("base64url");
  await ReportShare.create({ token, userId, report, expiresAt: new Date(+now + 30 * 86400000) });
  return { token, report };
}
