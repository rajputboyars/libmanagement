import { createHash } from "node:crypto";

export const SUBMIT_GRACE_MS = 3000;
export const COHORT_MIN = 10;
export const DAILY_COUNT = 10;
export const MINI_COUNT = 5;
export const DAILY_XP_CAP = 60;
export const OFFICIAL_STALE_DAYS = 90;
export const FLASH_INTERVALS = [1, 3, 7, 14, 30, 60] as const;

export type PlanItem = { questionId: string; section: string; marks: number; negative: number };
export type KeyedQuestion = { id: string; correctIndex: number; topicId?: string };
export type ScoredQuestion = { questionId: string; section: string; topicId?: string; status: "correct" | "incorrect" | "unattempted"; delta: number; timeMs: number };

const round = (value: number) => Math.round(value * 100) / 100;

/** Deterministic hash used for duplicate detection: ignores case, spacing and option order. */
export function contentHash(prompt: string, options: string[]) {
  const norm = (value: string) => value.toLowerCase().replace(/\s+/g, " ").replace(/[^\p{L}\p{N} ]/gu, "").trim();
  return createHash("sha256").update(`${norm(prompt)}|${options.map(norm).sort().join("|")}`).digest("hex");
}

export type ImportRow = { prompt?: unknown; options?: unknown; correctIndex?: unknown; explanation?: unknown; difficulty?: unknown };
/** Validates one import row; returns an error message or the cleaned row. */
export function validateImportRow(row: ImportRow): { error: string } | { value: { prompt: string; options: string[]; correctIndex: number; explanation: string; difficulty: "easy" | "medium" | "hard" } } {
  const prompt = typeof row.prompt === "string" ? row.prompt.trim() : "";
  if (prompt.length < 10 || prompt.length > 1000) return { error: "Prompt must be 10-1000 characters" };
  if (!Array.isArray(row.options) || row.options.length < 2 || row.options.length > 6) return { error: "2-6 options required" };
  const options = row.options.map((o) => (typeof o === "string" ? o.trim() : ""));
  if (options.some((o) => !o || o.length > 300)) return { error: "Options must be 1-300 characters" };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { error: "Options must be distinct" };
  const correctIndex = row.correctIndex;
  if (typeof correctIndex !== "number" || !Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return { error: "correctIndex is out of range" };
  const explanation = typeof row.explanation === "string" ? row.explanation.trim() : "";
  if (!explanation || explanation.length > 1500) return { error: "Explanation is required (max 1500)" };
  const difficulty = row.difficulty === "easy" || row.difficulty === "hard" ? row.difficulty : "medium";
  return { value: { prompt, options, correctIndex, explanation, difficulty } };
}

/** Server-side scoring. Negative marking applies only to wrong, attempted answers. */
export function scoreAttempt(
  plan: PlanItem[],
  keys: KeyedQuestion[],
  answers: { questionId: string; selectedIndex: number | null; timeMs?: number }[],
) {
  const key = new Map(keys.map((k) => [k.id, k]));
  const given = new Map(answers.map((a) => [a.questionId, a]));
  const rows: ScoredQuestion[] = plan.map((item) => {
    const k = key.get(item.questionId);
    const a = given.get(item.questionId);
    const attempted = !!a && a.selectedIndex !== null && a.selectedIndex !== undefined;
    const correct = attempted && !!k && a!.selectedIndex === k.correctIndex;
    return {
      questionId: item.questionId, section: item.section, topicId: k?.topicId,
      status: !attempted ? "unattempted" : correct ? "correct" : "incorrect",
      delta: !attempted ? 0 : correct ? item.marks : -item.negative,
      timeMs: a?.timeMs ?? 0,
    };
  });
  const maxScore = round(plan.reduce((sum, item) => sum + item.marks, 0));
  const score = round(rows.reduce((sum, row) => sum + row.delta, 0));
  const correct = rows.filter((r) => r.status === "correct").length;
  const incorrect = rows.filter((r) => r.status === "incorrect").length;
  const attempted = correct + incorrect;
  const group = (pick: (r: ScoredQuestion) => string | undefined) =>
    Object.values(rows.reduce<Record<string, { key: string; total: number; correct: number; incorrect: number; unattempted: number; score: number; timeMs: number }>>((all, r) => {
      const k = pick(r) ?? "general";
      all[k] ??= { key: k, total: 0, correct: 0, incorrect: 0, unattempted: 0, score: 0, timeMs: 0 };
      all[k].total++; all[k][r.status]++; all[k].score = round(all[k].score + r.delta); all[k].timeMs += r.timeMs;
      return all;
    }, {}));
  return {
    rows, score, maxScore, correct, incorrect, unattempted: rows.length - attempted, attempted,
    percent: maxScore > 0 ? round((Math.max(score, 0) / maxScore) * 100) : 0,
    accuracy: attempted ? Math.round((correct / attempted) * 100) : null,
    sections: group((r) => r.section), topics: group((r) => r.topicId),
  };
}

/** Time an attempt may still run, from server timestamps only. */
export const remainingMs = (deadline: Date, now: Date) => Math.max(0, deadline.getTime() - now.getTime());
export const acceptsAnswers = (deadline: Date, now: Date) => now.getTime() <= deadline.getTime() + SUBMIT_GRACE_MS;

/** Time spent on a question: server-measured gap between saves, capped so idle tabs are not counted. */
export function attributedTime(prev: { questionId?: string; at?: Date } | undefined, now: Date, capMs = 180000) {
  if (!prev?.questionId || !prev.at) return null;
  return { questionId: prev.questionId, ms: Math.min(Math.max(0, now.getTime() - prev.at.getTime()), capMs) };
}

/** Relative rank only inside a verified cohort: same template, first submitted attempt per student, minimum size. */
export function cohortStanding(mine: number, others: number[], min = COHORT_MIN) {
  const total = others.length + 1;
  if (total < min) return { comparable: false as const, have: total, needed: min };
  return { comparable: true as const, rank: 1 + others.filter((s) => s > mine).length, total };
}

export function topicStrength(attempted: number, correct: number) {
  if (attempted < 5) return "insufficient" as const;
  const accuracy = (correct / attempted) * 100;
  return accuracy >= 75 ? ("strong" as const) : accuracy < 50 ? ("weak" as const) : ("developing" as const);
}

export function flashNext(from: Date, intervalIndex: number) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() + FLASH_INTERVALS[Math.min(Math.max(intervalIndex, 0), FLASH_INTERVALS.length - 1)]);
  return d;
}
export function flashReview(intervalIndex: number, confidence: number) {
  return confidence <= 2 ? { intervalIndex: 0, lapse: true } : { intervalIndex: Math.min(5, intervalIndex + (confidence === 5 ? 2 : 1)), lapse: false };
}

/** Spreads overdue cards over upcoming days (oldest first) so a missed week does not become one huge pile. */
export function spreadOverdue(cards: { id: string; nextDueAt: Date }[], now: Date, perDay = 15, staleDays = 3) {
  const cutoff = now.getTime() - staleDays * 86400000;
  const stale = cards.filter((c) => c.nextDueAt.getTime() < cutoff).sort((a, b) => a.nextDueAt.getTime() - b.nextDueAt.getTime());
  return stale.map((card, i) => {
    const due = new Date(now);
    due.setUTCDate(due.getUTCDate() + Math.floor(i / perDay));
    return { id: card.id, nextDueAt: due };
  });
}

/** Stable per-user, per-day ordering for daily sets. */
export function seededOrder(ids: string[], seed: string) {
  return [...ids].sort((a, b) => {
    const ha = createHash("sha1").update(seed + a).digest("hex");
    const hb = createHash("sha1").update(seed + b).digest("hex");
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

export function dailyXp(correct: number, total: number) {
  return Math.min(30, 10 + correct * 2) * (total >= DAILY_COUNT ? 1 : 0);
}
export const miniXp = (correct: number) => Math.min(15, correct * 3);

export function checkpoint(percentDone: number) {
  return [25, 50, 75, 100].filter((c) => percentDone >= c);
}

export const officialDateStatus = (lastVerifiedAt: Date, now: Date) => (now.getTime() - lastVerifiedAt.getTime() > OFFICIAL_STALE_DAYS * 86400000 ? "needs-reverification" : "verified");
