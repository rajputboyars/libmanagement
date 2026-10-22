import { studentFeatureBlocked } from "@/lib/student-access-server";
import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "node:crypto";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { ExamDate, ExamGoal, Flashcard, MistakeEntry, PlanTask, Question, StudentNote, StudyPlan, SyllabusNode, TestAnswer, TestAttempt, TestTemplate, TopicProgress, XPTransaction } from "@/lib/models";
import { DAILY_COUNT, MINI_COUNT, attributedTime, acceptsAnswers, checkpoint, cohortStanding, flashNext, flashReview, officialDateStatus, remainingMs, seededOrder, spreadOverdue, topicStrength, type PlanItem } from "@/lib/prep";
import { enrolledExam, finalizeAttempt, publishedFilter, toPublic, today } from "@/lib/prep-server";
import { simplifyExplanation, aiConfigured } from "@/lib/prep-ai";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const pageOf = (req: NextRequest) => Math.max(1, Number(req.nextUrl.searchParams.get("page") || 1));
type Lean = Record<string, unknown> & { _id: unknown };
type Summary = { percent: number; accuracy: number | null; timeTracked?: boolean; rows: { questionId: string; section: string; topicId?: string; status: string; delta: number; timeMs: number }[]; topics: { key: string; correct: number; incorrect: number; total: number; timeMs: number }[] } & Record<string, unknown>;
type ResultAttempt = Lean & { state: string; deadline: Date; title: string; kind: string; result: Summary; plan: PlanItem[]; templateId?: unknown; libraryId?: unknown };
const shuffle = <T,>(items: T[]) => { const a = [...items]; for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

async function titles(ids: unknown[]) {
  const nodes = await SyllabusNode.find({ _id: { $in: ids.filter(Boolean) } }).select("title").lean<{ _id: unknown; title: string }[]>();
  return new Map(nodes.map((n) => [String(n._id), n.title]));
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "exam-prep"); if (blocked) return blocked; }
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("Student access required", 403);
  const p = request.nextUrl.searchParams;
  const view = p.get("view") || "overview";
  const now = new Date();
  const exam = await enrolledExam(user._id);

  if (view === "overview") {
    const [templates, active, recent, daily, due, open, dates, xp] = await Promise.all([
      exam ? TestTemplate.find({ examKey: exam.examKey, status: "published" }).sort({ kind: 1, title: 1 }).limit(50).lean<Lean[]>() : [],
      TestAttempt.find({ userId: user._id, state: "in-progress", deadline: { $gt: now } }).select("title kind deadline templateId").lean<Lean[]>(),
      TestAttempt.find({ userId: user._id, state: "submitted" }).sort({ submittedAt: -1 }).limit(5).select("title kind submittedAt result.percent result.score result.maxScore").lean<Lean[]>(),
      TestAttempt.findOne({ userId: user._id, kind: "daily", day: today() }).select("state deadline result.correct result.percent result.xpGranted").lean<Lean>(),
      Flashcard.countDocuments({ userId: user._id, nextDueAt: { $lte: now } }),
      MistakeEntry.countDocuments({ userId: user._id, status: "open" }),
      exam ? ExamDate.find({ examKey: exam.examKey, date: { $gte: now } }).sort({ date: 1 }).limit(5).lean<(Lean & { lastVerifiedAt: Date })[]>() : [],
      XPTransaction.aggregate([{ $match: { userId: user._id, day: today(), source: /^prep:/ } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    ]);
    return NextResponse.json({
      exam, templates: templates.map((t) => ({ ...t, sections: (t.sections as { count: number }[]).length, questions: (t.sections as { count: number }[]).reduce((s, x) => s + x.count, 0) })),
      active, recent, daily, flashcardsDue: due, openMistakes: due >= 0 ? open : 0, xpToday: xp[0]?.total || 0,
      dates: dates.map((d) => ({ ...d, status: officialDateStatus(d.lastVerifiedAt, now) })), serverNow: now,
    });
  }

  if (view === "attempt") {
    const id = p.get("id") || "";
    if (!objectId.safeParse(id).success) return err("Attempt not found", 404);
    const attempt = await TestAttempt.findOne({ _id: id, userId: user._id }).lean<Lean & { plan: PlanItem[]; deadline: Date; state: string }>();
    if (!attempt) return err("Attempt not found", 404);
    if (attempt.state === "submitted" || !acceptsAnswers(attempt.deadline, now)) {
      if (attempt.state !== "submitted") await finalizeAttempt(id, user._id).catch(() => null);
      return NextResponse.json({ finished: true, attemptId: id });
    }
    const [questions, answers] = await Promise.all([
      Question.find({ _id: { $in: attempt.plan.map((x) => x.questionId) } }).select("prompt options difficulty topicId").lean<(Lean & { prompt: string; options: string[] })[]>(),
      TestAnswer.find({ attemptId: id }).select("questionId selectedIndex flagged").lean<(Lean & { questionId: unknown; selectedIndex: number | null; flagged: boolean })[]>(),
    ]);
    const byId = new Map(questions.map((q) => [String(q._id), q]));
    return NextResponse.json({
      attemptId: id, title: attempt.title, kind: attempt.kind, serverNow: now, remainingMs: remainingMs(attempt.deadline, now), deadline: attempt.deadline,
      questions: attempt.plan.filter((x) => byId.has(String(x.questionId))).map((x) => toPublic(byId.get(String(x.questionId))!, x)),
      answers: Object.fromEntries(answers.map((a) => [String(a.questionId), { selectedIndex: a.selectedIndex, flagged: a.flagged }])),
    });
  }

  if (view === "result") {
    const id = p.get("id") || "";
    if (!objectId.safeParse(id).success) return err("Result not found", 404);
    let attempt = await TestAttempt.findOne({ _id: id, userId: user._id }).lean<ResultAttempt>();
    if (!attempt) return err("Result not found", 404);
    if (attempt.state !== "submitted") {
      if (attempt.deadline > now) return err("This attempt is still in progress", 409);
      await finalizeAttempt(id, user._id);
      attempt = (await TestAttempt.findOne({ _id: id, userId: user._id }).lean<ResultAttempt>())!;
    }
    const rows = attempt.result.rows as { questionId: string; section: string; topicId?: string; status: string; delta: number; timeMs: number }[];
    const [questions, answers, names] = await Promise.all([
      Question.find({ _id: { $in: rows.map((r) => r.questionId) } }).select("+correctIndex prompt options explanation").lean<(Lean & { prompt: string; options: string[]; correctIndex: number; explanation: string })[]>(),
      TestAnswer.find({ attemptId: id }).lean<(Lean & { questionId: unknown; selectedIndex: number | null; flagged: boolean })[]>(),
      titles([...(attempt.result.topics as { key: string }[]).map((t) => t.key)]),
    ]);
    const qMap = new Map(questions.map((q) => [String(q._id), q]));
    const aMap = new Map(answers.map((a) => [String(a.questionId), a]));
    let standing: unknown = { comparable: false, reason: "Practice sets are not ranked" };
    if (attempt.templateId && attempt.libraryId) {
      const first = await TestAttempt.aggregate([
        { $match: { templateId: attempt.templateId, libraryId: attempt.libraryId, state: "submitted" } },
        { $sort: { submittedAt: 1 } }, { $group: { _id: "$userId", percent: { $first: "$result.percent" } } },
      ]);
      const mine = first.find((f) => String(f._id) === String(user._id));
      standing = mine ? { ...cohortStanding(mine.percent, first.filter((f) => String(f._id) !== String(user._id)).map((f) => f.percent)), scope: "your library, first attempt per student", note: "Relative position within StudyQuest students in your library only — not a national rank." } : { comparable: false };
    }
    return NextResponse.json({
      attemptId: id, title: attempt.title, kind: attempt.kind, submittedAt: (attempt as Lean).submittedAt, autoSubmitted: (attempt as Lean).autoSubmitted,
      summary: { ...attempt.result, rows: undefined, topics: (attempt.result.topics as { key: string }[]).map((t) => ({ ...t, title: names.get(t.key) || "General" })) },
      standing,
      review: rows.map((r) => { const q = qMap.get(r.questionId); const a = aMap.get(r.questionId); return { questionId: r.questionId, prompt: q?.prompt, options: q?.options, correctIndex: q?.correctIndex, explanation: q?.explanation, selectedIndex: a?.selectedIndex ?? null, flagged: !!a?.flagged, status: r.status, delta: r.delta, timeMs: r.timeMs, section: r.section }; }),
    });
  }

  if (view === "analytics") {
    const attempts = await TestAttempt.find({ userId: user._id, state: "submitted" }).sort({ submittedAt: -1 }).limit(50).select("title kind submittedAt result.percent result.accuracy result.correct result.attempted result.topics result.timeTracked").lean<(Lean & { submittedAt: Date; result: Summary })[]>();
    const agg = new Map<string, { correct: number; incorrect: number; total: number; timeMs: number; timedQuestions: number }>();
    for (const a of attempts) for (const t of a.result.topics as { key: string; correct: number; incorrect: number; total: number; timeMs: number }[]) {
      const row = agg.get(t.key) ?? { correct: 0, incorrect: 0, total: 0, timeMs: 0, timedQuestions: 0 };
      row.correct += t.correct; row.incorrect += t.incorrect; row.total += t.total;
      if (a.result.timeTracked) { row.timeMs += t.timeMs; row.timedQuestions += t.correct + t.incorrect; }
      agg.set(t.key, row);
    }
    const names = await titles([...agg.keys()].filter((k) => /^[a-f\d]{24}$/i.test(k)));
    const topics = [...agg.entries()].map(([key, v]) => ({ topicId: key, title: names.get(key) || "General", attempted: v.correct + v.incorrect, correct: v.correct, accuracy: v.correct + v.incorrect ? Math.round((v.correct / (v.correct + v.incorrect)) * 100) : null, avgSeconds: v.timedQuestions ? Math.round(v.timeMs / v.timedQuestions / 1000) : null, strength: topicStrength(v.correct + v.incorrect, v.correct) })).sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));
    return NextResponse.json({ history: attempts.reverse().map((a) => ({ _id: a._id, title: a.title, kind: a.kind, date: a.submittedAt, percent: a.result.percent, accuracy: a.result.accuracy })), topics });
  }

  if (view === "mistakes") {
    const status = p.get("status") === "understood" ? "understood" : "open";
    const topicId = p.get("topicId");
    const filter = { userId: user._id, status, ...(topicId && objectId.safeParse(topicId).success ? { topicId } : {}) };
    const [entries, total, topicIds] = await Promise.all([
      MistakeEntry.find(filter).sort({ lastWrongAt: -1 }).skip((pageOf(request) - 1) * 10).limit(10).lean<(Lean & { questionId: unknown; topicId?: unknown })[]>(),
      MistakeEntry.countDocuments(filter), MistakeEntry.distinct("topicId", { userId: user._id }),
    ]);
    const [questions, names] = await Promise.all([Question.find({ _id: { $in: entries.map((e) => e.questionId) } }).select("prompt options difficulty").lean<Lean[]>(), titles([...topicIds, ...entries.map((e) => e.topicId)])]);
    const qMap = new Map(questions.map((q) => [String(q._id), q]));
    return NextResponse.json({ total, topics: topicIds.filter(Boolean).map((t) => ({ _id: t, title: names.get(String(t)) || "Topic" })), entries: entries.map((e) => ({ ...e, topicTitle: names.get(String(e.topicId)) || "General", question: qMap.get(String(e.questionId)) || null })) });
  }

  if (view === "flashcards") {
    const mode = p.get("mode") === "all" ? "all" : "due";
    const filter = { userId: user._id, ...(mode === "due" ? { nextDueAt: { $lte: now } } : {}) };
    const [cards, due, total, overdue] = await Promise.all([
      Flashcard.find(filter).sort({ nextDueAt: 1 }).skip((pageOf(request) - 1) * 20).limit(20).lean<Lean[]>(),
      Flashcard.countDocuments({ userId: user._id, nextDueAt: { $lte: now } }), Flashcard.countDocuments({ userId: user._id }),
      Flashcard.countDocuments({ userId: user._id, nextDueAt: { $lt: new Date(now.getTime() - 3 * 86400000) } }),
    ]);
    return NextResponse.json({ cards, due, total, overdue, reminder: due ? `${due} flashcard${due === 1 ? " is" : "s are"} ready for review.` : null });
  }

  if (view === "notes") {
    const q = (p.get("q") || "").trim().slice(0, 60);
    const topicId = p.get("topicId");
    const filter: Record<string, unknown> = { userId: user._id };
    if (q) filter.$or = [{ title: new RegExp(escapeRegex(q), "i") }, { body: new RegExp(escapeRegex(q), "i") }, { tags: q.toLowerCase() }];
    if (topicId && objectId.safeParse(topicId).success) filter.topicId = topicId;
    if (p.get("bookmarked") === "1") filter.bookmarked = true;
    const [notes, total] = await Promise.all([StudentNote.find(filter).sort({ bookmarked: -1, updatedAt: -1 }).skip((pageOf(request) - 1) * 20).limit(20).lean<Lean[]>(), StudentNote.countDocuments(filter)]);
    const names = await titles(notes.map((n) => n.topicId));
    return NextResponse.json({ total, notes: notes.map((n) => ({ ...n, topicTitle: names.get(String(n.topicId)) || null })) });
  }

  if (view === "topics") {
    if (!exam) return NextResponse.json({ topics: [] });
    const nodes = await SyllabusNode.find({ examKey: exam.examKey, active: true }).sort({ order: 1 }).select("title type parentId").lean<(Lean & { title: string; type: string; parentId?: unknown })[]>();
    return NextResponse.json({ topics: nodes.filter((n) => n.type === "topic").map((n) => ({ _id: n._id, title: n.title })) });
  }

  if (view === "journey") {
    if (!exam) return NextResponse.json({ exam: null });
    const [nodes, progress, goals, dates] = await Promise.all([
      SyllabusNode.find({ examKey: exam.examKey, active: true }).sort({ order: 1 }).select("title type parentId estimatedMinutes").lean<(Lean & { title: string; type: string; parentId?: unknown; estimatedMinutes: number })[]>(),
      TopicProgress.find({ userId: user._id }).select("topicId status mastery mockBest").lean<(Lean & { topicId: unknown; status: string; mastery: number; mockBest: number })[]>(),
      ExamGoal.find({ userId: user._id }).sort({ done: 1, targetDate: 1 }).limit(50).lean<Lean[]>(),
      ExamDate.find({ examKey: exam.examKey }).sort({ date: 1 }).limit(20).lean<(Lean & { lastVerifiedAt: Date })[]>(),
    ]);
    const prog = new Map(progress.map((x) => [String(x.topicId), x]));
    const children = (parent: unknown) => nodes.filter((n) => String(n.parentId ?? "") === String(parent ?? ""));
    const build = (node: (typeof nodes)[number]): Record<string, unknown> => {
      if (node.type === "topic") { const x = prog.get(String(node._id)); return { _id: node._id, title: node.title, type: "topic", status: x?.status || "not-started", mastery: x?.mastery || 0, mockBest: x?.mockBest || 0 }; }
      const kids = children(node._id).map(build);
      const topics = kids.flatMap((k) => (k.type === "topic" ? [k] : (k.children as Record<string, unknown>[]).filter((t) => t.type === "topic")));
      const leaves = node.type === "chapter" ? kids.filter((k) => k.type === "topic") : topics;
      const done = leaves.filter((k) => k.status === "completed").length;
      const percent = leaves.length ? Math.round((done / leaves.length) * 100) : 0;
      return { _id: node._id, title: node.title, type: node.type, percent, done, total: leaves.length, checkpoints: checkpoint(percent), children: kids };
    };
    const subjects = nodes.filter((n) => n.type === "subject").map(build);
    const allDone = subjects.reduce((s, x) => s + Number(x.done), 0), allTotal = subjects.reduce((s, x) => s + Number(x.total), 0);
    const overall = allTotal ? Math.round((allDone / allTotal) * 100) : 0;
    return NextResponse.json({
      exam, subjects, overall, checkpoints: checkpoint(overall), goals,
      daysToExam: exam.examDate ? Math.ceil((new Date(exam.examDate).getTime() - now.getTime()) / 86400000) : null,
      officialDates: dates.map((d) => ({ ...d, status: officialDateStatus(d.lastVerifiedAt, now), upcoming: new Date(d.date as Date) >= now })),
    });
  }
  return err("Unknown view", 404);
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "exam-prep"); if (blocked) return blocked; }
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("Student access required", 403);
  if (limited(`prep:${user._id}`, 300)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    const now = new Date();
    const exam = await enrolledExam(user._id);
    const needExam = () => { if (!exam) throw new Error("Choose your exam first on the roadmap page"); return exam; };

    async function create(doc: Record<string, unknown>) {
      try { return await TestAttempt.create({ userId: user!._id, libraryId: user!.libraryId, examKey: needExam().examKey, startedAt: now, ...doc }); }
      catch (e) {
        if ((e as { code?: number }).code !== 11000) throw e;
        const existing = await TestAttempt.findOne({ userId: user!._id, ...(doc.templateId ? { templateId: doc.templateId, state: { $in: ["in-progress", "scoring"] } } : { kind: doc.kind, day: doc.day }) });
        if (!existing) throw e;
        return existing;
      }
    }
    async function pick(items: { name: string; marks: number; negative: number; filter: Record<string, unknown>; count: number }[], seed?: string) {
      const chosen: PlanItem[] = [];
      for (const s of items) {
        const used = chosen.map((c) => c.questionId);
        const match = { ...publishedFilter(needExam().examKey, s.filter), _id: { $nin: used } };
        const pool = (await Question.find(match).select("_id").limit(2000).lean<{ _id: unknown }[]>()).map((q) => String(q._id));
        const ids = (seed ? seededOrder(pool, seed) : shuffle(pool)).slice(0, s.count);
        if (ids.length < s.count) throw new Error(`Not enough published questions for "${s.name}" (have ${ids.length}, need ${s.count}).`);
        chosen.push(...ids.map((questionId) => ({ questionId, section: s.name, marks: s.marks, negative: s.negative })));
      }
      return chosen;
    }
    const startPayload = (a: { _id: unknown; deadline: Date }) => ({ ok: true, attemptId: a._id, deadline: a.deadline });

    switch (body.action) {
      case "test-start": {
        const v = z.object({ templateId: objectId }).parse(body.data);
        const template = await TestTemplate.findOne({ _id: v.templateId, examKey: needExam().examKey, status: "published" }).lean<Lean & { kind: string; title: string; durationMinutes: number; sections: { name: string; subjectId?: unknown; topicId?: unknown; count: number; marks: number; negative: number }[] }>();
        if (!template) throw new Error("Test not available for your exam");
        const live = await TestAttempt.findOne({ userId: user._id, templateId: v.templateId, state: "in-progress" });
        if (live) {
          if (acceptsAnswers(live.deadline, now)) return NextResponse.json({ ...startPayload(live), resumed: true });
          await finalizeAttempt(live._id, user._id);
        }
        const plan = await pick(template.sections.map((s) => ({ name: s.name, marks: s.marks, negative: s.negative, count: s.count, filter: { ...(s.subjectId ? { subjectId: s.subjectId } : {}), ...(s.topicId ? { topicId: s.topicId } : {}) } })));
        const a = await create({ templateId: v.templateId, kind: template.kind, title: template.title, plan, deadline: new Date(now.getTime() + template.durationMinutes * 60000) });
        return NextResponse.json({ ...startPayload(a), resumed: a.plan.length > 0 && String(a.startedAt) !== String(now) });
      }
      case "daily-start": {
        const day = today();
        const existing = await TestAttempt.findOne({ userId: user._id, kind: "daily", day });
        if (existing) return NextResponse.json({ ...startPayload(existing), resumed: true, state: existing.state });
        const weak = await MistakeEntry.aggregate([{ $match: { userId: user._id, status: "open", topicId: { $exists: true } } }, { $group: { _id: "$topicId", n: { $sum: 1 } } }, { $sort: { n: -1 } }, { $limit: 3 }]);
        const plan: PlanItem[] = [];
        if (weak.length) plan.push(...await pick([{ name: "Focus topics", marks: 1, negative: 0, count: 4, filter: { topicId: { $in: weak.map((w) => w._id) } } }], `${user._id}:${day}:w`).catch(() => []));
        const rest = await pick([{ name: "Daily mix", marks: 1, negative: 0, count: DAILY_COUNT - plan.length, filter: { _id: { $nin: plan.map((x) => x.questionId) } } }], `${user._id}:${day}`).catch(async () => pick([{ name: "Daily mix", marks: 1, negative: 0, count: 5, filter: { _id: { $nin: plan.map((x) => x.questionId) } } }], `${user._id}:${day}`));
        const a = await create({ kind: "daily", day, title: `Daily practice · ${day}`, plan: [...plan, ...rest], deadline: new Date(now.getTime() + 20 * 60000) });
        return NextResponse.json(startPayload(a));
      }
      case "mini-start": {
        const v = z.object({ topicId: objectId }).parse(body.data);
        if (!await SyllabusNode.exists({ _id: v.topicId, examKey: needExam().examKey, type: "topic", active: true })) throw new Error("Topic not found in your exam");
        const live = await TestAttempt.findOne({ userId: user._id, kind: "mini", topicId: v.topicId, state: "in-progress", deadline: { $gt: now } });
        if (live) return NextResponse.json({ ...startPayload(live), resumed: true });
        const plan = await pick([{ name: "Mini challenge", marks: 1, negative: 0, count: MINI_COUNT, filter: { topicId: v.topicId } }]);
        const a = await TestAttempt.create({ userId: user._id, libraryId: user.libraryId, examKey: needExam().examKey, kind: "mini", day: today(), topicId: v.topicId, title: "Mini challenge", plan, startedAt: now, deadline: new Date(now.getTime() + 6 * 60000) });
        return NextResponse.json(startPayload(a));
      }
      case "answer-save": {
        const v = z.object({ attemptId: objectId, questionId: objectId, selectedIndex: z.number().int().min(0).max(5).nullable().optional(), flagged: z.boolean().optional(), viewing: objectId.optional() }).parse(body.data);
        const attempt = await TestAttempt.findOne({ _id: v.attemptId, userId: user._id });
        if (!attempt) throw new Error("Attempt not found");
        if (attempt.state !== "in-progress") throw new Error("This attempt is already submitted");
        if (!acceptsAnswers(attempt.deadline, now)) { await finalizeAttempt(attempt._id, user._id); return NextResponse.json({ ok: false, finished: true }); }
        if (!attempt.plan.some((x: PlanItem) => String(x.questionId) === v.questionId)) throw new Error("Question is not part of this attempt");
        if (v.selectedIndex !== undefined && v.selectedIndex !== null) {
          const q = await Question.findById(v.questionId).select("options").lean<{ options: string[] }>();
          if (!q || v.selectedIndex >= q.options.length) throw new Error("Invalid option");
        }
        const spent = attributedTime(attempt.cursor?.questionId ? { questionId: String(attempt.cursor.questionId), at: attempt.cursor.at } : undefined, now);
        if (spent && spent.ms > 0 && attempt.plan.some((x: PlanItem) => String(x.questionId) === spent.questionId)) await TestAnswer.updateOne({ attemptId: attempt._id, questionId: spent.questionId }, { $inc: { timeMs: spent.ms }, $setOnInsert: { userId: user._id } }, { upsert: true });
        const set: Record<string, unknown> = { userId: user._id };
        if (v.selectedIndex !== undefined) set.selectedIndex = v.selectedIndex;
        if (v.flagged !== undefined) set.flagged = v.flagged;
        await TestAnswer.updateOne({ attemptId: attempt._id, questionId: v.questionId }, { $set: set }, { upsert: true });
        await TestAttempt.updateOne({ _id: attempt._id, state: "in-progress" }, { cursor: { questionId: v.viewing ?? v.questionId, at: now } });
        return NextResponse.json({ ok: true, remainingMs: remainingMs(attempt.deadline, now) });
      }
      case "test-submit": {
        const v = z.object({ attemptId: objectId, answers: z.array(z.object({ questionId: objectId, selectedIndex: z.number().int().min(0).max(5).nullable() })).max(300).optional() }).parse(body.data);
        const { repeated } = await finalizeAttempt(v.attemptId, user._id, v.answers);
        return NextResponse.json({ ok: true, attemptId: v.attemptId, repeated });
      }
      case "mistake-answer": {
        const v = z.object({ questionId: objectId, selectedIndex: z.number().int().min(0).max(5).nullable() }).parse(body.data);
        const entry = await MistakeEntry.findOne({ userId: user._id, questionId: v.questionId });
        if (!entry) throw new Error("Not in your notebook");
        const q = await Question.findById(v.questionId).select("+correctIndex options explanation").lean<{ correctIndex: number; explanation: string; options: string[] }>();
        if (!q) throw new Error("Question unavailable");
        const correct = v.selectedIndex !== null && v.selectedIndex === q.correctIndex;
        if (v.selectedIndex !== null) { entry.retries.push({ at: now, correct }); entry.retries = entry.retries.slice(-20); await entry.save(); }
        return NextResponse.json({ ok: true, correct, correctIndex: q.correctIndex, explanation: q.explanation, revealedOnly: v.selectedIndex === null });
      }
      case "mistake-update": {
        const v = z.object({ id: objectId, status: z.enum(["open", "understood"]).optional(), note: z.string().trim().max(600).optional() }).parse(body.data);
        const set: Record<string, unknown> = {}; if (v.status) set.status = v.status; if (v.note !== undefined) set.note = v.note;
        const r = await MistakeEntry.findOneAndUpdate({ _id: v.id, userId: user._id }, { $set: set }, { new: true });
        if (!r) throw new Error("Entry not found");
        return NextResponse.json({ ok: true, record: r });
      }
      case "flash-create": {
        const v = z.object({ front: z.string().trim().min(2).max(400).optional(), back: z.string().trim().min(1).max(800).optional(), topicId: objectId.optional(), questionId: objectId.optional() }).parse(body.data);
        let { front, back } = v;
        if (v.questionId) {
          if (!await MistakeEntry.exists({ userId: user._id, questionId: v.questionId })) throw new Error("Only questions from your notebook can become cards");
          const q = await Question.findById(v.questionId).select("+correctIndex prompt options explanation topicId").lean<{ prompt: string; options: string[]; correctIndex: number; explanation: string; topicId?: unknown }>();
          if (!q) throw new Error("Question unavailable");
          front = q.prompt.slice(0, 400); back = `${q.options[q.correctIndex]} — ${q.explanation}`.slice(0, 800);
          if (!v.topicId && q.topicId) v.topicId = String(q.topicId);
        }
        if (!front || !back) throw new Error("Front and back are required");
        try { const card = await Flashcard.create({ userId: user._id, front, back, topicId: v.topicId, questionId: v.questionId, nextDueAt: now }); return NextResponse.json({ ok: true, record: card }); }
        catch (e) { if ((e as { code?: number }).code === 11000) throw new Error("This question is already a flashcard"); throw e; }
      }
      case "flash-review": {
        const v = z.object({ id: objectId, confidence: z.number().int().min(1).max(5) }).parse(body.data);
        const card = await Flashcard.findOne({ _id: v.id, userId: user._id });
        if (!card) throw new Error("Card not found");
        if (card.nextDueAt > now) throw new Error("This card is not due yet");
        const next = flashReview(card.intervalIndex, v.confidence);
        card.intervalIndex = next.intervalIndex; card.lapses += next.lapse ? 1 : 0; card.lastReviewedAt = now; card.nextDueAt = flashNext(now, next.intervalIndex);
        card.history.push({ at: now, confidence: v.confidence }); card.history = card.history.slice(-30); await card.save();
        return NextResponse.json({ ok: true, nextDueAt: card.nextDueAt });
      }
      case "flash-delete": { const v = z.object({ id: objectId }).parse(body.data); await Flashcard.deleteOne({ _id: v.id, userId: user._id }); return NextResponse.json({ ok: true }); }
      case "flash-catchup": {
        const cards = await Flashcard.find({ userId: user._id, nextDueAt: { $lt: now } }).select("nextDueAt").lean<{ _id: unknown; nextDueAt: Date }[]>();
        const moves = spreadOverdue(cards.map((c) => ({ id: String(c._id), nextDueAt: c.nextDueAt })), now);
        if (moves.length) await Flashcard.bulkWrite(moves.map((m) => ({ updateOne: { filter: { _id: m.id, userId: user._id }, update: { $set: { nextDueAt: m.nextDueAt } } } })));
        return NextResponse.json({ ok: true, rescheduled: moves.length });
      }
      case "flash-plan-sync": {
        const due = await Flashcard.countDocuments({ userId: user._id, nextDueAt: { $lte: now } });
        if (!due) throw new Error("No flashcards are due");
        const plan = await StudyPlan.findOne({ userId: user._id, status: "active" }).lean<{ _id: unknown }>();
        if (!plan) throw new Error("Generate a study plan first");
        const day = new Date(`${today()}T00:00:00.000Z`);
        const title = "Flashcard review";
        const task = await PlanTask.findOneAndUpdate({ userId: user._id, planId: plan._id, scheduledFor: day, title, kind: "revision" }, { $setOnInsert: { durationMinutes: Math.min(30, Math.max(10, due * 2)), status: "pending" } }, { upsert: true, new: true });
        return NextResponse.json({ ok: true, record: task });
      }
      case "note-save": {
        const v = z.object({ id: objectId.optional(), title: z.string().trim().min(1).max(120), body: z.string().max(6000).default(""), topicId: objectId.optional(), tags: z.array(z.string().trim().toLowerCase().min(1).max(30)).max(8).default([]), bookmarked: z.boolean().optional() }).parse(body.data);
        if (v.topicId && !await SyllabusNode.exists({ _id: v.topicId })) throw new Error("Topic not found");
        const { id, ...fields } = v;
        const rec = id ? await StudentNote.findOneAndUpdate({ _id: id, userId: user._id }, { $set: fields, ...(v.topicId ? {} : { $unset: { topicId: 1 } }) }, { new: true, runValidators: true }) : await StudentNote.create({ ...fields, userId: user._id });
        if (!rec) throw new Error("Note not found");
        return NextResponse.json({ ok: true, record: rec });
      }
      case "note-bookmark": { const v = z.object({ id: objectId, bookmarked: z.boolean() }).parse(body.data); const r = await StudentNote.findOneAndUpdate({ _id: v.id, userId: user._id }, { bookmarked: v.bookmarked }, { new: true }); if (!r) throw new Error("Note not found"); return NextResponse.json({ ok: true }); }
      case "note-delete": { const v = z.object({ id: objectId }).parse(body.data); await StudentNote.deleteOne({ _id: v.id, userId: user._id }); return NextResponse.json({ ok: true }); }
      case "goal-save": { const v = z.object({ title: z.string().trim().min(2).max(120), targetDate: z.iso.datetime().optional() }).parse(body.data); if (await ExamGoal.countDocuments({ userId: user._id, done: false }) >= 30) throw new Error("Finish some goals before adding more"); return NextResponse.json({ ok: true, record: await ExamGoal.create({ userId: user._id, title: v.title, targetDate: v.targetDate ? new Date(v.targetDate) : undefined }) }); }
      case "goal-toggle": { const v = z.object({ id: objectId, done: z.boolean() }).parse(body.data); const r = await ExamGoal.findOneAndUpdate({ _id: v.id, userId: user._id }, { done: v.done, doneAt: v.done ? now : undefined }, { new: true }); if (!r) throw new Error("Goal not found"); return NextResponse.json({ ok: true }); }
      case "goal-delete": { const v = z.object({ id: objectId }).parse(body.data); await ExamGoal.deleteOne({ _id: v.id, userId: user._id }); return NextResponse.json({ ok: true }); }
      case "ai-simplify": {
        const v = z.object({ questionId: objectId }).parse(body.data);
        if (limited(`prep-ai:${user._id}`, 6)) throw new Error("AI help is limited to a few requests per minute");
        const seen = await MistakeEntry.exists({ userId: user._id, questionId: v.questionId }) || await TestAnswer.exists({ userId: user._id, questionId: v.questionId, attemptId: { $in: await TestAttempt.distinct("_id", { userId: user._id, state: "submitted" }) } });
        if (!seen) throw new Error("Finish an attempt containing this question first");
        const q = await Question.findById(v.questionId).select("explanation").lean<{ explanation: string }>();
        const text = q && aiConfigured() ? await simplifyExplanation(q.explanation) : null;
        return NextResponse.json({ ok: true, available: !!text, text, label: text ? "AI-generated simplification — may be imperfect. The reviewed explanation above is authoritative." : "AI help is unavailable. The reviewed explanation is shown instead." });
      }
      default: throw new Error("Unsupported action");
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
