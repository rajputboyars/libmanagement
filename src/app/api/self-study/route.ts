import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { DailyPlan, DailyReflection, Notification, SelfGoal, StudyPartner, StudySession, SyllabusNode, TestAttempt, TopicProgress, User } from "@/lib/models";
import { enrolledExam } from "@/lib/prep-server";
import { studentFeatureBlocked } from "@/lib/student-access-server";
import { CHAPTER_STEPS, bySubject, chapterComplete, change, energyPattern, focusQuality, goalStatus, heatmap, istDay, planKeptRate, stepsDone, type ChapterSteps } from "@/lib/self-study";
import { libraryClock } from "@/lib/library-hours";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
type Lean = Record<string, unknown> & { _id: unknown };
type Session = { completedAt: Date; activeSeconds: number; subject?: string; distractions?: number };
const pairKey = (a: unknown, b: unknown) => [String(a), String(b)].sort().join(":");

async function todayMinutes(userId: unknown, day: string) {
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - 330 * 60000); // India midnight
  const rows = await StudySession.find({ userId, state: "complete", completedAt: { $gte: since } }).select("activeSeconds").lean<{ activeSeconds: number }[]>();
  return Math.round(rows.reduce((n, r) => n + r.activeSeconds, 0) / 60);
}

/** Chapters of the student's exam (chapters, or topics when the exam has no chapters) grouped by subject, with checklist steps. */
async function tracker(userId: unknown) {
  const exam = await enrolledExam(userId as never);
  if (!exam) return { exam: null, subjects: [], goals: [] };
  const nodes = await SyllabusNode.find({ examKey: exam.examKey, active: true }).select("parentId type title order").sort({ order: 1 }).lean<(Lean & { parentId?: unknown; type: string; title: string })[]>();
  const units = nodes.filter((n) => n.type === "chapter").length ? nodes.filter((n) => n.type === "chapter") : nodes.filter((n) => n.type === "topic");
  const byId = new Map(nodes.map((n) => [String(n._id), n]));
  const subjectOf = (n: (typeof nodes)[number]) => {
    let p = n.parentId ? byId.get(String(n.parentId)) : undefined;
    while (p && p.type !== "subject") p = p.parentId ? byId.get(String(p.parentId)) : undefined;
    return p;
  };
  const progress = await TopicProgress.find({ userId, topicId: { $in: units.map((u) => u._id) } }).select("topicId steps").lean<{ topicId: unknown; steps?: ChapterSteps }[]>();
  const stepsOf = new Map(progress.map((p) => [String(p.topicId), p.steps ?? {}]));
  const groups = new Map<string, { _id: string; title: string; chapters: { _id: string; title: string; steps: ChapterSteps; done: number }[] }>();
  for (const u of units) {
    const s = subjectOf(u);
    const key = s ? String(s._id) : "other";
    if (!groups.has(key)) groups.set(key, { _id: key, title: s?.title ?? "Other", chapters: [] });
    const steps = stepsOf.get(String(u._id)) ?? {};
    groups.get(key)!.chapters.push({ _id: String(u._id), title: u.title, steps, done: stepsDone(steps) });
  }
  const subjects = [...groups.values()].map((g) => ({ ...g, complete: g.chapters.filter((c) => c.done === CHAPTER_STEPS.length).length, percent: g.chapters.length ? Math.round((g.chapters.reduce((n, c) => n + c.done, 0) / (g.chapters.length * CHAPTER_STEPS.length)) * 100) : 0 }));
  const goals = await SelfGoal.find({ userId }).sort({ deadline: 1 }).lean<(Lean & { title: string; topicIds: unknown[]; deadline: Date; createdAt: Date })[]>();
  return {
    exam: { examKey: exam.examKey },
    subjects,
    goals: goals.map((g) => {
      const done = g.topicIds.filter((t) => chapterComplete(stepsOf.get(String(t)))).length;
      return { _id: g._id, title: g.title, deadline: g.deadline, chapters: g.topicIds.length, done, ...goalStatus(done, g.topicIds.length, g.createdAt, g.deadline) };
    }),
  };
}

async function month(userId: unknown, now = new Date()) {
  const ist = new Date(+now + 330 * 60000);
  const startOf = (y: number, m: number) => new Date(Date.UTC(y, m, 1) - 330 * 60000);
  const thisStart = startOf(ist.getUTCFullYear(), ist.getUTCMonth()), lastStart = startOf(ist.getUTCFullYear(), ist.getUTCMonth() - 1);
  const sum = async (from: Date, to: Date) => {
    const [sessions, tests, chapters] = await Promise.all([
      StudySession.find({ userId, state: "complete", completedAt: { $gte: from, $lt: to } }).select("activeSeconds subject").lean<Session[]>(),
      TestAttempt.find({ userId, state: "submitted", submittedAt: { $gte: from, $lt: to } }).select("result.percent").lean<{ result?: { percent?: number } }[]>(),
      TopicProgress.countDocuments({ userId, completedAt: { $gte: from, $lt: to } }),
    ]);
    const scores = tests.map((t) => t.result?.percent).filter((p): p is number => typeof p === "number");
    return { minutes: Math.round(sessions.reduce((n, s) => n + s.activeSeconds, 0) / 60), sessions: sessions.length, tests: tests.length, avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null, chapters, topSubject: bySubject(sessions)[0]?.subject ?? null };
  };
  const [current, previous] = await Promise.all([sum(thisStart, now), sum(lastStart, thisStart)]);
  return { label: ist.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" }), current, previous, change: { minutes: change(current.minutes, previous.minutes), sessions: change(current.sessions, previous.sessions), tests: change(current.tests, previous.tests) } };
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("Self-study tools are for students", 403);
  const view = request.nextUrl.searchParams.get("view") || "today";
  const now = new Date();
  const day = libraryClock(now).date;

  if (view === "today") {
    const yesterday = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const [plan, reflection, open] = await Promise.all([
      DailyPlan.findOne({ userId: user._id, day }).lean<Lean & { tasks: { text: string; done: boolean }[] }>(),
      DailyReflection.findOne({ userId: user._id, day }).lean<Lean & { energy: number; hard: string }>(),
      DailyPlan.findOne({ userId: user._id, day: yesterday }).lean<Lean & { tasks: { text: string; done: boolean }[] }>(),
    ]);
    return NextResponse.json({ day, plan, reflection, yesterday: open ? { tasks: open.tasks } : null, hour: Math.floor(libraryClock(now).minutes / 60) });
  }
  if (view === "insights" || view === "month") {
    const blocked = await studentFeatureBlocked(user, "deep-insights");
    if (blocked) return blocked;
    if (view === "month") return NextResponse.json(await month(user._id, now));
    const yearAgo = new Date(+now - 366 * 86400000), monthAgo = new Date(+now - 30 * 86400000);
    const [sessions, plans, reflections] = await Promise.all([
      StudySession.find({ userId: user._id, state: "complete", completedAt: { $gte: yearAgo } }).select("completedAt activeSeconds subject distractions").sort({ completedAt: -1 }).lean<Session[]>(),
      DailyPlan.find({ userId: user._id, day: { $gte: istDay(monthAgo), $lt: day } }).select("tasks").lean<{ tasks: { done: boolean }[] }[]>(),
      DailyReflection.find({ userId: user._id, day: { $gte: istDay(new Date(+now - 90 * 86400000)) } }).select("day energy").lean<{ day: string; energy: number }[]>(),
    ]);
    const map = heatmap(sessions, now);
    const recent = sessions.slice(0, 30);
    return NextResponse.json({
      heatmap: map,
      subjects: bySubject(sessions.filter((s) => +new Date(s.completedAt) >= +monthAgo)),
      recentSubjects: [...new Set(sessions.map((s) => s.subject).filter(Boolean))].slice(0, 12),
      focusQuality: recent.length ? Math.round(recent.reduce((n, s) => n + focusQuality(s.distractions ?? 0), 0) / recent.length) : null,
      distractions: recent.reduce((n, s) => n + (s.distractions ?? 0), 0),
      sessionsCounted: recent.length,
      planKept: planKeptRate(plans),
      energy: energyPattern(reflections, new Map(map.map((d) => [d.date, d.minutes]))),
      activeDays: map.filter((d) => d.minutes > 0).length,
    });
  }
  if (view === "tracker") {
    const blocked = await studentFeatureBlocked(user, "planning");
    if (blocked) return blocked;
    return NextResponse.json(await tracker(user._id));
  }
  if (view === "partner") {
    const blocked = await studentFeatureBlocked(user, "partner");
    if (blocked) return blocked;
    const links = await StudyPartner.find({ $or: [{ a: user._id }, { b: user._id }], status: { $in: ["pending", "accepted"] } }).lean<(Lean & { a: unknown; b: unknown; status: string })[]>();
    const other = (l: { a: unknown; b: unknown }) => (String(l.a) === String(user._id) ? l.b : l.a);
    const people = await User.find({ _id: { $in: links.map(other) } }).select("name").lean<(Lean & { name: string })[]>();
    const me = await todayMinutes(user._id, day);
    return NextResponse.json({
      me,
      partners: await Promise.all(
        links.map(async (l) => ({
          _id: l._id,
          status: l.status,
          incoming: l.status === "pending" && String(l.b) === String(user._id),
          name: people.find((p) => String(p._id) === String(other(l)))?.name.split(" ")[0] ?? "Student",
          minutes: l.status === "accepted" ? await todayMinutes(other(l), day) : null,
        })),
      ),
    });
  }
  return err("Unknown view", 404);
}

const PLANNING = new Set(["plan-save", "plan-tick", "reflection-save", "step-set", "goal-save", "goal-delete"]);

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("Self-study tools are for students", 403);
  if (limited(`self-study:${user._id}`, 60)) return err("Please slow down", 429);
  try {
    const body = await request.json();
    const action = z.string().parse(body.action);
    const blocked = await studentFeatureBlocked(user, PLANNING.has(action) ? "planning" : "partner");
    if (blocked) return blocked;
    const day = libraryClock().date;
    const d = body.data ?? {};

    if (action === "plan-save") {
      const v = z.object({ tasks: z.array(z.string().trim().max(120)).max(3) }).parse(d);
      const tasks = v.tasks.filter(Boolean).map((text) => ({ text, done: false }));
      if (!tasks.length) throw new Error("Write at least one task");
      const old = await DailyPlan.findOne({ userId: user._id, day }).lean<{ tasks: { text: string; done: boolean }[] }>();
      const merged = tasks.map((t) => ({ ...t, done: old?.tasks.find((o) => o.text === t.text)?.done ?? false }));
      await DailyPlan.updateOne({ userId: user._id, day }, { $set: { tasks: merged } }, { upsert: true });
    } else if (action === "plan-tick") {
      const v = z.object({ index: z.number().int().min(0).max(2), done: z.boolean(), day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(d);
      const res = await DailyPlan.updateOne({ userId: user._id, day: v.day ?? day }, { $set: { [`tasks.${v.index}.done`]: v.done } });
      if (!res.matchedCount) throw new Error("Plan not found");
    } else if (action === "reflection-save") {
      const v = z.object({ energy: z.number().int().min(1).max(5), hard: z.string().trim().max(300).default("") }).parse(d);
      await DailyReflection.updateOne({ userId: user._id, day }, { $set: v }, { upsert: true });
    } else if (action === "step-set") {
      const v = z.object({ topicId: objectId, step: z.enum(CHAPTER_STEPS), done: z.boolean() }).parse(d);
      if (!(await SyllabusNode.exists({ _id: v.topicId }))) throw new Error("Chapter not found");
      const doc = await TopicProgress.findOneAndUpdate({ userId: user._id, topicId: v.topicId }, { $set: { [`steps.${v.step}`]: v.done } }, { upsert: true, new: true });
      const complete = chapterComplete(doc.steps);
      if (complete && !doc.completedAt) await TopicProgress.updateOne({ _id: doc._id }, { $set: { completedAt: new Date(), status: "completed" } });
      if (!complete && doc.completedAt) await TopicProgress.updateOne({ _id: doc._id }, { $unset: { completedAt: 1 }, $set: { status: "studying" } });
    } else if (action === "goal-save") {
      const v = z.object({ title: z.string().trim().min(2).max(100), topicIds: z.array(objectId).min(1).max(200), deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(d);
      if ((await SelfGoal.countDocuments({ userId: user._id })) >= 20) throw new Error("You can keep up to 20 goals");
      await SelfGoal.create({ userId: user._id, title: v.title, topicIds: v.topicIds, deadline: new Date(`${v.deadline}T18:29:59Z`) });
    } else if (action === "goal-delete") {
      await SelfGoal.deleteOne({ _id: objectId.parse(d.id), userId: user._id });
    } else if (action === "partner-invite") {
      const email = z.email().parse(String(d.email ?? "").toLowerCase().trim());
      const other = await User.findOne({ email, role: "student", deletedAt: { $exists: false } }).select("_id name").lean<{ _id: unknown; name: string }>();
      if (!other || String(other._id) === String(user._id)) throw new Error("No other student account with that email");
      if ((await StudyPartner.countDocuments({ $or: [{ a: user._id }, { b: user._id }], status: { $in: ["pending", "accepted"] } })) >= 3) throw new Error("You can have up to 3 study partners");
      await StudyPartner.updateOne({ pairKey: pairKey(user._id, other._id) }, { $set: { a: user._id, b: other._id, status: "pending" } }, { upsert: true });
      await Notification.create({ userId: other._id, title: "Study partner request", message: `${user.name.split(" ")[0]} wants to be your study partner. Open Study partner to accept.` });
    } else if (action === "partner-respond" || action === "partner-end") {
      const v = z.object({ id: objectId, accept: z.boolean().default(false) }).parse(d);
      const filter = action === "partner-respond" ? { _id: v.id, b: user._id, status: "pending" } : { _id: v.id, $or: [{ a: user._id }, { b: user._id }] };
      const res = await StudyPartner.updateOne(filter, { $set: { status: action === "partner-respond" && v.accept ? "accepted" : "ended" } });
      if (!res.matchedCount) throw new Error("Partner request not found");
    } else throw new Error("Unknown action");
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err(e.issues[0]?.message ?? "Invalid request");
    return err(e instanceof Error ? e.message : "Could not save");
  }
}
