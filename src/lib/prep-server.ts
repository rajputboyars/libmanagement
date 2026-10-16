import type { Types } from "mongoose";
import { MistakeEntry, Question, StudentExam, TestAnswer, TestAttempt, TopicProgress, XPTransaction } from "./models";
import { DAILY_XP_CAP, acceptsAnswers, dailyXp, miniXp, scoreAttempt, type PlanItem } from "./prep";

type Id = Types.ObjectId | string;
export const today = () => new Date().toISOString().slice(0, 10);
/** Published = reviewed and live. Legacy questions without a status are treated as published. */
export const publishedFilter = (examKey: string, extra: Record<string, unknown> = {}) => ({ examKey, active: true, $or: [{ status: "published" }, { status: { $exists: false } }], ...extra });

export const toPublic = (question: { _id: unknown; prompt: string; options: string[]; difficulty?: string; topicId?: unknown }, item?: PlanItem) => ({
  _id: question._id, prompt: question.prompt, options: question.options, difficulty: question.difficulty, topicId: question.topicId,
  section: item?.section, marks: item?.marks, negative: item?.negative,
});

export async function enrolledExam(userId: Id) {
  return StudentExam.findOne({ userId }).lean<{ examKey: string; examDate?: Date; weeklyMinutes: number }>();
}

type AttemptDoc = {
  _id: Id; userId: Id; kind: string; templateId?: Id; topicId?: Id; day?: string; plan: PlanItem[]; deadline: Date; startedAt: Date; state: string;
  result?: Record<string, unknown>; autoSubmitted?: boolean; save: () => Promise<unknown>;
};

/** Atomic, idempotent finalisation. Repeat calls return the stored result; only the lock holder scores. */
export async function finalizeAttempt(attemptId: Id, userId: Id, payload?: { questionId: string; selectedIndex: number | null }[]) {
  const now = new Date();
  const stale = new Date(now.getTime() - 30000);
  const locked = await TestAttempt.findOneAndUpdate(
    { _id: attemptId, userId, $or: [{ state: "in-progress" }, { state: "scoring", scoringAt: { $lt: stale } }] },
    { state: "scoring", scoringAt: now },
    { new: true },
  );
  if (!locked) {
    const current = await TestAttempt.findOne({ _id: attemptId, userId }).lean<AttemptDoc>();
    if (!current) throw new Error("Attempt not found");
    if (current.state === "submitted") return { result: current.result!, repeated: true, attempt: current };
    // Another request holds the scoring lock: wait briefly for its result instead of failing.
    for (let i = 0; i < 40; i++) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const again = await TestAttempt.findOne({ _id: attemptId, userId }).lean<AttemptDoc>();
      if (again?.state === "submitted") return { result: again.result!, repeated: true, attempt: again };
    }
    throw new Error("Submission is still being processed. Try again in a moment.");
  }
  const attempt = locked as unknown as AttemptDoc & { libraryId?: Id };
  if (payload?.length && acceptsAnswers(attempt.deadline, now)) {
    const planned = new Set(attempt.plan.map((p) => String(p.questionId)));
    const ops = payload.filter((a) => planned.has(a.questionId)).map((a) => ({ updateOne: { filter: { attemptId: attempt._id, questionId: a.questionId }, update: { $set: { userId, selectedIndex: a.selectedIndex } }, upsert: true } }));
    if (ops.length) await TestAnswer.bulkWrite(ops);
  }
  const [saved, keys] = await Promise.all([
    TestAnswer.find({ attemptId: attempt._id }).lean<{ questionId: Id; selectedIndex: number | null; timeMs: number }[]>(),
    Question.find({ _id: { $in: attempt.plan.map((p) => p.questionId) } }).select("+correctIndex topicId").lean<{ _id: Id; correctIndex: number; topicId?: Id }[]>(),
  ]);
  const scored = scoreAttempt(
    attempt.plan.map((p) => ({ questionId: String(p.questionId), section: String(p.section), marks: Number(p.marks), negative: Number(p.negative) })),
    keys.map((k) => ({ id: String(k._id), correctIndex: k.correctIndex, topicId: k.topicId ? String(k.topicId) : undefined })),
    saved.map((a) => ({ questionId: String(a.questionId), selectedIndex: a.selectedIndex, timeMs: a.timeMs })),
  );
  const prior = await TestAttempt.find({ userId, state: "submitted", kind: attempt.kind, ...(attempt.templateId ? { templateId: attempt.templateId } : {}), ...(attempt.topicId ? { topicId: attempt.topicId } : {}), _id: { $ne: attempt._id } }).select("result.percent").lean<{ result?: { percent?: number } }[]>();
  const previousBest = prior.length ? Math.max(...prior.map((p) => p.result?.percent ?? 0)) : null;
  const eligible = scored.attempted * 2 >= attempt.plan.length;
  const baseXp = attempt.kind === "daily" ? dailyXp(scored.correct, attempt.plan.length) : attempt.kind === "mini" ? miniXp(scored.correct) : eligible ? 20 : 0;
  const source = `prep:${attempt.kind}:${attempt.kind === "daily" ? attempt.day : attempt.kind === "mini" ? `${attempt.topicId}:${attempt.day}` : attempt.templateId}`;
  let xpGranted = 0;
  if (baseXp > 0) {
    const used = await XPTransaction.aggregate([{ $match: { userId, day: today(), source: /^prep:/ } }, { $group: { _id: null, total: { $sum: "$amount" } } }]);
    const amount = Math.min(baseXp, Math.max(0, DAILY_XP_CAP - (used[0]?.total || 0)));
    if (amount > 0) xpGranted = (await XPTransaction.updateOne({ userId, source }, { $setOnInsert: { amount, day: today() } }, { upsert: true })).upsertedCount ? amount : 0;
  }
  const result = {
    score: scored.score, maxScore: scored.maxScore, percent: scored.percent, accuracy: scored.accuracy, correct: scored.correct, incorrect: scored.incorrect, unattempted: scored.unattempted, attempted: scored.attempted,
    sections: scored.sections, topics: scored.topics, rows: scored.rows, xpGranted, personalBest: previousBest !== null && scored.percent > previousBest, previousBest,
    timeTracked: scored.rows.some((r) => r.timeMs > 0),
  };
  await TestAttempt.updateOne({ _id: attempt._id }, { state: "submitted", submittedAt: now, autoSubmitted: now.getTime() > attempt.deadline.getTime(), result, xpGranted });
  const wrong = scored.rows.filter((r) => r.status === "incorrect");
  if (wrong.length) await MistakeEntry.bulkWrite(wrong.map((r) => ({ updateOne: { filter: { userId, questionId: r.questionId }, update: { $set: { lastWrongAt: now, status: "open", ...(r.topicId ? { topicId: r.topicId } : {}) }, $inc: { wrongCount: 1 } }, upsert: true } })));
  const topicOps = scored.topics.filter((t) => /^[a-f\d]{24}$/i.test(t.key) && t.correct + t.incorrect >= 2).map((t) => ({ updateOne: { filter: { userId, topicId: t.key }, update: { $max: { mockBest: Math.round((t.correct / t.total) * 100) } }, upsert: true } }));
  if (topicOps.length) await TopicProgress.bulkWrite(topicOps);
  return { result, repeated: false, attempt };
}
