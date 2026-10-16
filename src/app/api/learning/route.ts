import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import {
  LearningAudit,
  QuizAttempt,
  RevisionSchedule,
  StudentExam,
  SyllabusNode,
  TopicProgress,
  WeeklyLearningInsight,
  CoinTransaction,
  StudySession,
} from "@/lib/models";
import { buildLearningIntelligence, weekStart } from "@/lib/learning";
import { nextRevisionDate } from "@/lib/phase2";
import { aiNarrative, buildWeeklySummary, deterministicNarrative, safeNarrative } from "@/lib/weekly-insights";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);

async function weeklyView(source: Awaited<ReturnType<typeof sourceData>>, userId: unknown) {
  const start = weekStart(source.now);
  const previous = new Date(start.getTime() - 7 * 86400000);
  const minutes = async (from: Date, to: Date) => {
    const rows = await StudySession.aggregate([{ $match: { userId, state: "complete", completedAt: { $gte: from, $lt: to } } }, { $group: { _id: null, seconds: { $sum: "$activeSeconds" } } }]);
    return Math.floor((rows[0]?.seconds || 0) / 60);
  };
  const [current, last] = await Promise.all([minutes(start, new Date(start.getTime() + 7 * 86400000)), minutes(previous, start)]);
  const summary = buildWeeklySummary({ metrics: source.intelligence.metrics, trends: source.intelligence.trends, focusMinutes: { current, previous: last }, weakTopicTitles: source.intelligence.weakTopics.map((t) => t.title) });
  return { summary, narrative: deterministicNarrative(summary), aiAvailable: process.env.STUDYQUEST_AI_PROVIDER === "ollama" };
}

async function sourceData(userId: unknown) {
  const now = new Date();
  const selectedExam = await StudentExam.findOne({ userId }).lean() as null | { examKey: string; weakTopicIds?: unknown[] };
  const examKey = selectedExam?.examKey || "ssc";
  const [nodes, progressRows, attemptRows, revisionRows] = await Promise.all([
    SyllabusNode.find({ examKey, active: true }).sort({ order: 1 }).lean(),
    TopicProgress.find({ userId }).lean(),
    QuizAttempt.find({ userId, state: "submitted", submittedAt: { $gte: new Date(now.getTime() - 120 * 86400000) } }).sort({ submittedAt: -1 }).limit(100).lean(),
    RevisionSchedule.find({ userId }).sort({ nextDueAt: 1 }).limit(500).lean(),
  ]);
  const nodeMap = new Map(nodes.map((node) => [String(node._id), node]));
  const topics = nodes.filter((node) => node.type === "topic").map((topic) => {
    const chapter = nodeMap.get(String(topic.parentId));
    const subject = chapter ? nodeMap.get(String(chapter.parentId)) : undefined;
    return { id: String(topic._id), title: String(topic.title), subject: String(subject?.title || chapter?.title || "General") };
  });
  const progress = progressRows.map((row) => ({ topicId: String(row.topicId), mastery: Number(row.mastery || 0), status: String(row.status) }));
  const attempts = attemptRows.map((row) => ({
    submittedAt: new Date(row.submittedAt),
    topicBreakdown: ((row.topicBreakdown || []) as Array<{ topicId: unknown; total: number; correct: number }>).map((entry) => ({ topicId: String(entry.topicId), total: Number(entry.total), correct: Number(entry.correct) })),
  }));
  const revisions = revisionRows.map((row) => ({
    topicId: String(row.topicId), nextDueAt: new Date(row.nextDueAt), intervalIndex: Number(row.intervalIndex || 0),
    history: ((row.history || []) as Array<{ reviewedAt?: Date; confidence?: number; event?: string }>).map((entry) => ({ reviewedAt: entry.reviewedAt ? new Date(entry.reviewedAt) : undefined, confidence: entry.confidence, event: entry.event })),
  }));
  const intelligence = buildLearningIntelligence({ now, topics, attempts, progress, revisions, explicitWeakTopicIds: (selectedExam?.weakTopicIds || []).map(String) });
  return { now, examKey, nodes, revisionRows, intelligence };
}

export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "student") return NextResponse.json({ error: "Student access required" }, { status: 403 });
  const source = await sourceData(user._id);
  const titles = new Map(source.nodes.map((node) => [String(node._id), String(node.title)]));
  const revisions = source.revisionRows.map((row) => ({
    _id: row._id,
    topicId: row.topicId,
    title: titles.get(String(row.topicId)) || "Study topic",
    intervalIndex: row.intervalIndex,
    nextDueAt: row.nextDueAt,
    lastReviewedAt: row.lastReviewedAt,
    snoozeCount: row.snoozeCount || 0,
    due: new Date(row.nextDueAt) <= source.now,
    historyCount: row.history?.filter((entry: { event?: string }) => !entry.event || entry.event === "review").length || 0,
  }));
  const latestSnapshot = await WeeklyLearningInsight.findOne({ userId: user._id }).sort({ generatedAt: -1 }).select("week generatedAt").lean();
  return NextResponse.json({
    serverNow: source.now.toISOString(),
    examKey: source.examKey,
    intelligence: source.intelligence,
    weekly: await weeklyView(source, user._id),
    revisions,
    reminders: revisions.filter((revision) => revision.due).map((revision) => ({ revisionId: revision._id, title: `${revision.title} is ready to review`, message: "A short recall session now will strengthen the next interval." })),
    latestSnapshot,
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "student") return NextResponse.json({ error: "Student access required" }, { status: 403 });
  if (limited(`learning:${user._id}`, 40)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  try {
    const body = z.object({ action: z.enum(["revision-complete", "revision-snooze", "revision-reschedule", "insight-save", "insight-narrative"]), data: z.unknown().default({}) }).parse(await request.json());
    let record: unknown;
    if (body.action === "revision-complete") {
      const value = z.object({ revisionId: objectId, confidence: z.number().int().min(1).max(5) }).parse(body.data);
      const schedule = await RevisionSchedule.findOne({ _id: value.revisionId, userId: user._id });
      if (!schedule) throw new Error("Revision not found");
      const now = new Date();
      const earnedDueAt = new Date(schedule.nextDueAt);
      if (earnedDueAt.getTime() > now.getTime() + 3600000) throw new Error("This revision is not due yet");
      schedule.intervalIndex = value.confidence <= 2 ? 0 : Math.min(5, schedule.intervalIndex + 1);
      schedule.lastReviewedAt = now;
      schedule.nextDueAt = nextRevisionDate(now, schedule.intervalIndex);
      schedule.snoozeCount = 0;
      schedule.history.push({ reviewedAt: now, confidence: value.confidence, event: "review", scheduledFor: schedule.nextDueAt });
      await schedule.save();
      await TopicProgress.findOneAndUpdate({ userId: user._id, topicId: schedule.topicId }, { revisionLevel: schedule.intervalIndex + 1, nextRevisionAt: schedule.nextDueAt, $max: { mastery: Math.min(100, 55 + schedule.intervalIndex * 8) } });
      record = schedule;
      await LearningAudit.create({ userId: user._id, action: "revision-reviewed", recordId: schedule._id, metadata: { confidence: value.confidence, nextDueAt: schedule.nextDueAt } });
      await CoinTransaction.updateOne(
        { userId: user._id, source: `revision:${schedule._id}:${earnedDueAt.toISOString()}` },
        { $setOnInsert: { libraryId: user.libraryId, amount: 2, description: `Completed revision: ${schedule.topicId}` } },
        { upsert: true },
      );
    } else if (body.action === "revision-snooze") {
      const value = z.object({ revisionId: objectId, hours: z.union([z.literal(4), z.literal(24), z.literal(72)]) }).parse(body.data);
      const schedule = await RevisionSchedule.findOne({ _id: value.revisionId, userId: user._id });
      if (!schedule) throw new Error("Revision not found");
      if ((schedule.snoozeCount || 0) >= 3) throw new Error("This revision has reached its snooze limit. Reschedule it instead.");
      const previousDueAt = schedule.nextDueAt;
      schedule.nextDueAt = new Date(Date.now() + value.hours * 3600000);
      schedule.snoozeCount = (schedule.snoozeCount || 0) + 1;
      schedule.history.push({ reviewedAt: new Date(), event: "snooze", previousDueAt, scheduledFor: schedule.nextDueAt });
      await schedule.save();
      record = schedule;
      await LearningAudit.create({ userId: user._id, action: "revision-snoozed", recordId: schedule._id, metadata: { hours: value.hours, previousDueAt, nextDueAt: schedule.nextDueAt } });
    } else if (body.action === "revision-reschedule") {
      const value = z.object({ revisionId: objectId, scheduledFor: z.iso.datetime() }).parse(body.data);
      const scheduledFor = new Date(value.scheduledFor);
      if (scheduledFor.getTime() < Date.now() + 3600000 || scheduledFor.getTime() > Date.now() + 90 * 86400000) throw new Error("Choose a time between one hour and 90 days from now");
      const schedule = await RevisionSchedule.findOne({ _id: value.revisionId, userId: user._id });
      if (!schedule) throw new Error("Revision not found");
      const previousDueAt = schedule.nextDueAt;
      schedule.nextDueAt = scheduledFor; schedule.snoozeCount = 0;
      schedule.history.push({ reviewedAt: new Date(), event: "reschedule", previousDueAt, scheduledFor });
      await schedule.save();
      record = schedule;
      await LearningAudit.create({ userId: user._id, action: "revision-rescheduled", recordId: schedule._id, metadata: { previousDueAt, scheduledFor } });
    } else if (body.action === "insight-narrative") {
      if (limited(`narrative:${user._id}`, 3)) throw new Error("Please wait before regenerating");
      const weekly = await weeklyView(await sourceData(user._id), user._id);
      const text = await aiNarrative(weekly.summary);
      return NextResponse.json({ ok: true, narrative: text || weekly.narrative, source: text ? "ai" : "deterministic", fallback: !text });
    } else {
      const source = await sourceData(user._id);
      const weekly = await weeklyView(source, user._id);
      const requested = z.object({ narrative: z.string().max(1000).optional() }).parse(body.data ?? {}).narrative;
      const ai = requested !== undefined && requested !== weekly.narrative ? safeNarrative(requested, weekly.summary) : null;
      const week = weekStart(source.now).toISOString().slice(0, 10);
      record = await WeeklyLearningInsight.findOneAndUpdate(
        { userId: user._id, week },
        { examKey: source.examKey, metrics: source.intelligence.metrics, recommendations: source.intelligence.recommendations, topicSignals: source.intelligence.topics.slice(0, 20), generatedAt: source.now, version: 2, summary: weekly.summary, narrative: ai || weekly.narrative, narrativeSource: ai ? "ai" : "deterministic" },
        { upsert: true, new: true, runValidators: true },
      );
      await LearningAudit.create({ userId: user._id, action: "insight-saved", recordId: (record as { _id: unknown })._id, metadata: { week } });
    }
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update learning data" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
