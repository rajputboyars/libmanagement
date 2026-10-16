import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import {
  ChallengeProgress,
  EventRegistration,
  ExamCatalog,
  Friendship,
  GardenTransaction,
  LearningChallenge,
  LibraryEvent,
  LibraryFeedback,
  Notification,
  PlanTask,
  Question,
  QuizAttempt,
  RevisionSchedule,
  RoomParticipant,
  StudentExam,
  StudentGarden,
  StudyPlan,
  StudyRoom,
  SyllabusNode,
  TopicProgress,
  User,
  XPTransaction,
  CoinTransaction,
} from "@/lib/models";
import {
  EXAM_KEYS,
  generateDeterministicPlan,
  gardenState,
  nextRevisionDate,
  scoreQuiz,
  startOfStudyWeek,
} from "@/lib/phase2";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const examKey = z.enum(EXAM_KEYS);
const dateString = z.iso.datetime();
const availabilitySchema = z.object({
  mon: z.number().int().min(0).max(360), tue: z.number().int().min(0).max(360),
  wed: z.number().int().min(0).max(360), thu: z.number().int().min(0).max(360),
  fri: z.number().int().min(0).max(360), sat: z.number().int().min(0).max(360),
  sun: z.number().int().min(0).max(360),
});

function errorResponse(error: unknown) {
  return NextResponse.json(
    { error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to complete request" },
    { status: error instanceof z.ZodError ? 422 : 400 },
  );
}

export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const storedExams = await ExamCatalog.find({ active: true }).sort({ title: 1 }).lean();
  const exams = storedExams.length ? storedExams : [
    { key: "ssc", title: "SSC" }, { key: "banking", title: "Banking" },
    { key: "railway", title: "Railway" }, { key: "upsc", title: "UPSC" },
    { key: "neet", title: "NEET" },
  ];
  const selectedExam = await StudentExam.findOne({ userId: user._id }).lean() as null | { _id: unknown; examKey: string; examDate: Date; subjectIds: Array<{ toString(): string }>; weakTopicIds: Array<{ toString(): string }> };
  const selectedKey = req.nextUrl.searchParams.get("exam") || selectedExam?.examKey || "ssc";
  const syllabus = await SyllabusNode.find(user.role === "super-admin" ? { active: true } : { examKey: selectedKey, active: true }).sort({ examKey: 1, type: 1, order: 1 }).lean();

  if (user.role !== "student") {
    const libraryId = user.libraryId;
    const [feedback, events, questions] = await Promise.all([
      libraryId ? LibraryFeedback.find({ libraryId }).sort({ createdAt: -1 }).limit(100).lean() : [],
      libraryId ? LibraryEvent.find({ libraryId }).sort({ startsAt: 1 }).limit(100).lean() : [],
      user.role === "super-admin" ? Question.find({ examKey: selectedKey }).select("+correctIndex").sort({ createdAt: -1 }).limit(100).lean() : [],
    ]);
    return NextResponse.json({ exams, syllabus, feedback, events, questions, aiAvailable: Boolean(process.env.STUDYQUEST_AI_ENDPOINT) });
  }

  const now = new Date();
  const [progress, plan, attempts, revisions, garden, friendships, challenges, rooms, feedback, events] = await Promise.all([
    TopicProgress.find({ userId: user._id }).lean(),
    StudyPlan.findOne({ userId: user._id, status: "active" }).sort({ createdAt: -1 }).lean(),
    QuizAttempt.find({ userId: user._id, state: "submitted" }).sort({ submittedAt: -1 }).limit(20).lean(),
    RevisionSchedule.find({ userId: user._id }).sort({ nextDueAt: 1 }).lean(),
    StudentGarden.findOne({ userId: user._id }).lean(),
    Friendship.find({ $or: [{ requesterId: user._id }, { recipientId: user._id }] }).lean(),
    LearningChallenge.find({ $or: [{ creatorId: user._id }, { invitedUserIds: user._id }, { participantIds: user._id }], endsAt: { $gte: now } }).sort({ endsAt: 1 }).lean(),
    StudyRoom.find({ $or: [{ hostId: user._id }, { _id: { $in: await RoomParticipant.find({ userId: user._id, status: { $ne: "left" } }).distinct("roomId") } }], state: { $ne: "ended" } }).lean(),
    user.libraryId ? LibraryFeedback.find({ libraryId: user.libraryId, userId: user._id }).sort({ createdAt: -1 }).lean() : [],
    user.libraryId ? LibraryEvent.find({ libraryId: user.libraryId, status: "published", endsAt: { $gte: now } }).sort({ startsAt: 1 }).lean() : [],
  ]);
  const planRecord = plan as null | { _id: unknown };
  const gardenRecord = garden as null | { growthPoints?: number };
  const tasks = planRecord ? await PlanTask.find({ planId: planRecord._id, userId: user._id }).sort({ scheduledFor: 1 }).lean() : [];
  const eventIds = events.map((event) => event._id);
  const registrations = await EventRegistration.find({ userId: user._id, eventId: { $in: eventIds } }).lean();
  return NextResponse.json({
    exams, selectedExam, syllabus, progress, plan, tasks, attempts, revisions, garden: gardenState(gardenRecord?.growthPoints || 0),
    gardenRecord: garden, friendships, challenges, rooms, feedback, events, registrations,
    serverNow: now.toISOString(), aiAvailable: Boolean(process.env.STUDYQUEST_AI_ENDPOINT),
  });
}

export async function POST(req: NextRequest) {
  if (!validOrigin(req)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (limited(`phase2:${user._id}`, 80)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await req.json());
    const data = body.data;
    let record: unknown;

    if (body.action === "exam-save") {
      const value = z.object({ examKey, customExam: z.string().trim().max(100).default(""), examDate: dateString, weeklyMinutes: z.number().int().min(60).max(5040), subjectIds: z.array(objectId).max(30).default([]), weakTopicIds: z.array(objectId).max(100).default([]) }).parse(data);
      if (value.examKey === "custom" && !value.customExam) throw new Error("Name your custom exam");
      if (new Date(value.examDate) <= new Date()) throw new Error("Exam date must be in the future");
      if (value.subjectIds.length && await SyllabusNode.countDocuments({ _id: { $in: value.subjectIds }, examKey: value.examKey, type: "subject", active: true }) !== new Set(value.subjectIds).size) throw new Error("Invalid subject selection");
      if (value.weakTopicIds.length && await SyllabusNode.countDocuments({ _id: { $in: value.weakTopicIds }, examKey: value.examKey, type: "topic", active: true }) !== new Set(value.weakTopicIds).size) throw new Error("Invalid weak-topic selection");
      record = await StudentExam.findOneAndUpdate({ userId: user._id }, { ...value, examDate: new Date(value.examDate) }, { upsert: true, new: true, runValidators: true });
    } else if (body.action === "catalog-save") {
      if (user.role !== "super-admin") throw new Error("Super-admin access required");
      const value = z.object({ key: z.string().trim().toLowerCase().min(2).max(40), title: z.string().trim().min(2).max(80), description: z.string().trim().max(500).default(""), active: z.boolean().default(true) }).parse(data);
      record = await ExamCatalog.findOneAndUpdate({ key: value.key }, value, { upsert: true, new: true, runValidators: true });
    } else if (body.action === "syllabus-save") {
      if (user.role !== "super-admin") throw new Error("Super-admin access required");
      const value = z.object({ id: objectId.optional(), examKey: z.string().min(2).max(40), parentId: objectId.nullable().default(null), type: z.enum(["subject", "chapter", "topic"]), title: z.string().trim().min(2).max(120), order: z.number().int().min(0).max(10000).default(0), estimatedMinutes: z.number().int().min(10).max(10000).default(50) }).parse(data);
      const parent = value.parentId ? await SyllabusNode.findOne({ _id: value.parentId, examKey: value.examKey, active: true }).lean() as null | { type: string } : null;
      if (value.type === "subject" && value.parentId) throw new Error("Subjects cannot have a parent");
      if (value.type === "chapter" && parent?.type !== "subject") throw new Error("A chapter must belong to a subject");
      if (value.type === "topic" && parent?.type !== "chapter") throw new Error("A topic must belong to a chapter");
      record = value.id ? await SyllabusNode.findByIdAndUpdate(value.id, value, { new: true, runValidators: true }) : await SyllabusNode.create(value);
    } else if (body.action === "topic-progress") {
      const value = z.object({ topicId: objectId, status: z.enum(["not-started", "studying", "completed"]) }).parse(data);
      const topic = await SyllabusNode.findOne({ _id: value.topicId, type: "topic", active: true });
      if (!topic) throw new Error("Topic not found");
      const completedAt = value.status === "completed" ? new Date() : undefined;
      record = await TopicProgress.findOneAndUpdate({ userId: user._id, topicId: topic._id }, { status: value.status, ...(completedAt ? { completedAt, mastery: 60, nextRevisionAt: nextRevisionDate(completedAt, 0) } : {}) }, { upsert: true, new: true, runValidators: true });
      if (completedAt) await RevisionSchedule.findOneAndUpdate({ userId: user._id, topicId: topic._id }, { $setOnInsert: { intervalIndex: 0, nextDueAt: nextRevisionDate(completedAt, 0) } }, { upsert: true, runValidators: true });
    } else if (body.action === "plan-generate") {
      const value = z.object({ availability: availabilitySchema, preferAI: z.boolean().default(false) }).parse(data);
      const selected = await StudentExam.findOne({ userId: user._id });
      if (!selected) throw new Error("Select an exam before generating a plan");
      const topics = await SyllabusNode.find({ examKey: selected.examKey, type: "topic", active: true, ...(selected.subjectIds.length ? { $or: [{ parentId: { $in: selected.subjectIds } }, { _id: { $in: selected.weakTopicIds } }] } : {}) }).lean();
      if (!topics.length) throw new Error("No active topics are available for this exam");
      const generated = generateDeterministicPlan({ startDate: new Date(), examDate: selected.examDate, availability: value.availability, topics: topics.map((topic) => ({ id: String(topic._id), title: topic.title, subject: String(topic.parentId || "General"), estimatedMinutes: topic.estimatedMinutes, weak: selected.weakTopicIds.some((idValue: { toString(): string }) => idValue.toString() === String(topic._id)) })) });
      await StudyPlan.updateMany({ userId: user._id, status: "active" }, { status: "archived" });
      const plan = await StudyPlan.create({ userId: user._id, examKey: selected.examKey, startDate: new Date(), endDate: selected.examDate, availability: value.availability, generatedBy: "deterministic" });
      await PlanTask.insertMany(generated.tasks.map((task) => ({ ...task, userId: user._id, planId: plan._id })));
      record = { plan, taskCount: generated.tasks.length, unscheduledTopicIds: generated.unscheduledTopicIds, aiFallback: value.preferAI && !process.env.STUDYQUEST_AI_ENDPOINT };
    } else if (body.action === "plan-task") {
      const value = z.object({ id: objectId, status: z.enum(["completed", "missed"]), scheduledFor: dateString.optional() }).parse(data);
      const task = await PlanTask.findOne({ _id: value.id, userId: user._id });
      if (!task) throw new Error("Plan task not found");
      if (task.status === "completed") throw new Error("Completed tasks cannot be changed");
      if (value.status === "completed") {
        task.status = "completed"; task.completedAt = new Date(); await task.save(); record = task;
      } else {
        task.status = "rescheduled"; await task.save();
        const target = value.scheduledFor ? new Date(value.scheduledFor) : new Date(Date.now() + 86400000);
        record = await PlanTask.create({ userId: user._id, planId: task.planId, topicId: task.topicId, sourceTaskId: task._id, title: task.title, kind: task.kind, scheduledFor: target, durationMinutes: task.durationMinutes, status: "pending" });
      }
    } else if (body.action === "question-save") {
      throw new Error("Questions are now managed in the Question bank, which adds review and publishing steps");
    } else if (body.action === "quiz-start") {
      const value = z.object({ examKey, topicId: objectId.optional(), count: z.number().int().min(3).max(20).default(10) }).parse(data);
      const match = { examKey: value.examKey, active: true, $or: [{ status: "published" }, { status: { $exists: false } }], ...(value.topicId ? { topicId: value.topicId } : {}) };
      const questions = await Question.aggregate([{ $match: match }, { $sample: { size: value.count } }, { $project: { prompt: 1, options: 1, difficulty: 1, topicId: 1 } }]);
      if (questions.length < 3) throw new Error("At least three questions are needed");
      const startedAt = new Date(), expiresAt = new Date(startedAt.getTime() + questions.length * 60000);
      const attempt = await QuizAttempt.create({ userId: user._id, examKey: value.examKey, questionIds: questions.map((question) => question._id), startedAt, expiresAt });
      record = { attemptId: attempt._id, questions, startedAt, expiresAt };
    } else if (body.action === "quiz-submit") {
      const value = z.object({ attemptId: objectId, answers: z.array(z.object({ questionId: objectId, selectedIndex: z.number().int().min(0).max(5) })).max(20) }).parse(data);
      const attempt = await QuizAttempt.findOne({ _id: value.attemptId, userId: user._id, state: "active" });
      if (!attempt) throw new Error("Quiz is already submitted or unavailable");
      if (new Date() > new Date(attempt.expiresAt.getTime() + 15000)) { attempt.state = "expired"; await attempt.save(); throw new Error("Quiz time has expired"); }
      const questions = await Question.find({ _id: { $in: attempt.questionIds } }).select("+correctIndex").lean();
      const validIds = new Set(questions.map((question) => String(question._id)));
      if (value.answers.some((answer) => !validIds.has(answer.questionId))) throw new Error("Answer does not belong to this quiz");
      const scored = scoreQuiz(questions.map((question) => ({ id: String(question._id), correctIndex: question.correctIndex, topicId: question.topicId ? String(question.topicId) : undefined })), value.answers);
      const previouslyRewarded = await QuizAttempt.distinct("rewardedQuestionIds", { userId: user._id, state: "submitted" });
      const previous = new Set(previouslyRewarded.map(String));
      const rewardedQuestionIds = scored.details.filter((answer) => answer.correct && !previous.has(answer.questionId)).map((answer) => answer.questionId);
      const xpGranted = rewardedQuestionIds.length * 5;
      attempt.answers = value.answers.map((answer) => ({ ...answer, correct: scored.details.find((detail) => detail.questionId === answer.questionId)?.correct || false }));
      attempt.rewardedQuestionIds = rewardedQuestionIds; attempt.submittedAt = new Date(); attempt.state = "submitted"; attempt.score = scored.correct; attempt.accuracy = scored.accuracy; attempt.topicBreakdown = scored.topicBreakdown; attempt.xpGranted = xpGranted; await attempt.save();
      if (xpGranted) await XPTransaction.create({ userId: user._id, source: `quiz:${attempt._id}`, amount: xpGranted, day: new Date().toISOString().slice(0, 10) });
      if (rewardedQuestionIds.length) await CoinTransaction.updateOne(
        { userId: user._id, source: `quiz:${attempt._id}` },
        { $setOnInsert: { libraryId: user.libraryId, amount: rewardedQuestionIds.length, description: `${rewardedQuestionIds.length} first-time correct quiz answer${rewardedQuestionIds.length === 1 ? "" : "s"}` } },
        { upsert: true },
      );
      const explanations = questions.map((question) => ({ questionId: question._id, correctIndex: question.correctIndex, explanation: question.explanation }));
      record = { ...scored, xpGranted, explanations };
    } else if (body.action === "revision-complete") {
      const value = z.object({ topicId: objectId, confidence: z.number().int().min(1).max(5) }).parse(data);
      const schedule = await RevisionSchedule.findOne({ userId: user._id, topicId: value.topicId });
      if (!schedule) throw new Error("Revision topic not found");
      const now = new Date();
      schedule.intervalIndex = value.confidence <= 2 ? 0 : Math.min(5, schedule.intervalIndex + 1);
      schedule.lastReviewedAt = now; schedule.nextDueAt = nextRevisionDate(now, schedule.intervalIndex); schedule.history.push({ reviewedAt: now, confidence: value.confidence }); await schedule.save();
      await TopicProgress.findOneAndUpdate({ userId: user._id, topicId: value.topicId }, { revisionLevel: schedule.intervalIndex + 1, nextRevisionAt: schedule.nextDueAt, $max: { mastery: Math.min(100, 55 + schedule.intervalIndex * 8) } });
      record = schedule;
    } else if (body.action === "garden-refresh") {
      const ledger = await XPTransaction.find({ userId: user._id, amount: { $gt: 0 } }).lean();
      for (const entry of ledger) await GardenTransaction.updateOne({ userId: user._id, source: `xp:${entry.source}` }, { $setOnInsert: { points: Math.min(100, entry.amount), earnedAt: entry.createdAt || new Date() } }, { upsert: true });
      const aggregate = await GardenTransaction.aggregate([{ $match: { userId: user._id } }, { $group: { _id: null, points: { $sum: "$points" } } }]);
      const state = gardenState(aggregate[0]?.points || 0);
      const existing = await StudentGarden.findOne({ userId: user._id });
      const growthPoints = Math.max(existing?.growthPoints || 0, state.points);
      record = await StudentGarden.findOneAndUpdate({ userId: user._id }, { $max: { growthPoints }, $addToSet: { unlockedPlants: { $each: state.unlockedPlants.map((plant) => plant.key) }, unlockedMilestones: state.stage.key }, lastCalculatedAt: new Date() }, { upsert: true, new: true });
      const week = startOfStudyWeek();
      const weekly = await GardenTransaction.aggregate([{ $match: { userId: user._id, earnedAt: { $gte: week } } }, { $group: { _id: null, points: { $sum: "$points" } } }]);
      record = { garden: record, state: gardenState(growthPoints), weeklyPoints: weekly[0]?.points || 0 };
    } else if (body.action === "garden-select") {
      const value = z.object({ plantKey: z.enum(["fern", "lavender", "bonsai"]) }).parse(data);
      record = await StudentGarden.findOneAndUpdate({ userId: user._id, unlockedPlants: value.plantKey }, { activePlantKey: value.plantKey }, { new: true });
      if (!record) throw new Error("Plant is still locked");
    } else if (body.action === "friend-request") {
      const value = z.object({ email: z.email().toLowerCase() }).parse(data);
      const recipient = await User.findOne({ email: value.email, role: "student" });
      if (!recipient || recipient._id.equals(user._id)) throw new Error("Student not found");
      const pairKey = [String(user._id), String(recipient._id)].sort().join(":");
      record = await Friendship.findOneAndUpdate({ pairKey }, { $setOnInsert: { requesterId: user._id, recipientId: recipient._id, status: "pending" } }, { upsert: true, new: true });
      await Notification.create({ libraryId: recipient.libraryId, userId: recipient._id, title: "New friend request", message: `${user.name} sent you a private friend request.` });
    } else if (body.action === "friend-respond") {
      const value = z.object({ id: objectId, status: z.enum(["accepted", "declined", "blocked"]) }).parse(data);
      record = await Friendship.findOneAndUpdate({ _id: value.id, recipientId: user._id, status: "pending" }, { status: value.status }, { new: true });
      if (!record) throw new Error("Friend request not found");
    } else if (body.action === "challenge-create") {
      const value = z.object({ friendIds: z.array(objectId).min(1).max(20), title: z.string().trim().min(3).max(100), metric: z.enum(["focus-minutes", "topics", "quiz-accuracy"]), target: z.number().int().min(1).max(10000) }).parse(data);
      const accepted = await Friendship.find({ status: "accepted", $or: [{ requesterId: user._id, recipientId: { $in: value.friendIds } }, { recipientId: user._id, requesterId: { $in: value.friendIds } }] });
      if (accepted.length !== new Set(value.friendIds).size) throw new Error("Challenges can only invite accepted friends");
      const startsAt = new Date(), endsAt = new Date(startsAt.getTime() + 7 * 86400000);
      record = await LearningChallenge.create({ creatorId: user._id, invitedUserIds: value.friendIds, participantIds: [user._id], title: value.title, metric: value.metric, target: value.target, startsAt, endsAt, status: "open" });
      await ChallengeProgress.create({ challengeId: (record as { _id: unknown })._id, userId: user._id });
    } else if (body.action === "challenge-join") {
      const value = z.object({ id: objectId }).parse(data);
      record = await LearningChallenge.findOneAndUpdate({ _id: value.id, invitedUserIds: user._id, endsAt: { $gt: new Date() } }, { $addToSet: { participantIds: user._id }, status: "active" }, { new: true });
      if (!record) throw new Error("Challenge invitation not found");
      await ChallengeProgress.updateOne({ challengeId: value.id, userId: user._id }, { $setOnInsert: { value: 0 } }, { upsert: true });
    } else if (body.action === "room-create") {
      const value = z.object({ title: z.string().trim().min(3).max(80), goalMinutes: z.number().int().min(10).max(240) }).parse(data);
      const joinCode = crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
      record = await StudyRoom.create({ hostId: user._id, libraryId: user.libraryId, ...value, joinCode });
      await RoomParticipant.create({ roomId: (record as { _id: unknown })._id, userId: user._id, status: "ready" });
    } else if (body.action === "room-join") {
      const value = z.object({ joinCode: z.string().trim().toUpperCase().length(6) }).parse(data);
      const room = await StudyRoom.findOne({ joinCode: value.joinCode, state: { $ne: "ended" } });
      if (!room) throw new Error("Focus room not found");
      if (room.libraryId && user.libraryId && !room.libraryId.equals(user.libraryId)) throw new Error("This room belongs to another library");
      await RoomParticipant.updateOne({ roomId: room._id, userId: user._id }, { $set: { status: "joined" }, $setOnInsert: { joinedAt: new Date() } }, { upsert: true }); record = room;
    } else if (body.action === "room-start") {
      const value = z.object({ id: objectId }).parse(data);
      record = await StudyRoom.findOneAndUpdate({ _id: value.id, hostId: user._id, state: "waiting" }, { state: "running", startsAt: new Date(Date.now() + 5000) }, { new: true });
      if (!record) throw new Error("Only the host can start this room");
    } else if (body.action === "room-complete") {
      const value = z.object({ id: objectId }).parse(data);
      const room = await StudyRoom.findOne({ _id: value.id, state: "running" });
      if (!room || !await RoomParticipant.exists({ roomId: room._id, userId: user._id })) throw new Error("Room session not found");
      record = await RoomParticipant.findOneAndUpdate({ roomId: room._id, userId: user._id }, { status: "complete", completedAt: new Date() }, { new: true });
    } else if (body.action === "feedback-create") {
      if (!user.libraryId) throw new Error("Join a library to send feedback");
      const value = z.object({ kind: z.enum(["feedback", "complaint"]), category: z.enum(["facilities", "noise", "cleanliness", "staff", "service", "other"]), message: z.string().trim().min(10).max(1200) }).parse(data);
      record = await LibraryFeedback.create({ libraryId: user.libraryId, userId: user._id, ...value });
    } else if (body.action === "feedback-respond") {
      if (!user.libraryId || !["owner", "staff"].includes(user.role)) throw new Error("Library team access required");
      const value = z.object({ id: objectId, message: z.string().trim().min(2).max(1200), status: z.enum(["reviewing", "resolved"]) }).parse(data);
      record = await LibraryFeedback.findOneAndUpdate({ _id: value.id, libraryId: user.libraryId }, { status: value.status, $push: { responses: { ownerId: user._id, message: value.message, createdAt: new Date() } } }, { new: true, runValidators: true });
      if (!record) throw new Error("Feedback item not found");
    } else if (body.action === "event-save") {
      if (!user.libraryId || !["owner", "staff"].includes(user.role)) throw new Error("Library team access required");
      const value = z.object({ id: objectId.optional(), type: z.enum(["quiz", "workshop", "study-challenge"]), title: z.string().trim().min(3).max(120), description: z.string().trim().max(1000).default(""), startsAt: dateString, endsAt: dateString, capacity: z.number().int().min(1).max(1000), status: z.enum(["draft", "published", "cancelled", "complete"]) }).refine((item) => new Date(item.endsAt) > new Date(item.startsAt), "Event must end after it starts").parse(data);
      record = value.id ? await LibraryEvent.findOneAndUpdate({ _id: value.id, libraryId: user.libraryId }, value, { new: true, runValidators: true }) : await LibraryEvent.create({ ...value, libraryId: user.libraryId, creatorId: user._id });
    } else if (body.action === "event-register") {
      const value = z.object({ id: objectId }).parse(data);
      const event = await LibraryEvent.findOne({ _id: value.id, libraryId: user.libraryId, status: "published", endsAt: { $gt: new Date() } });
      if (!event) throw new Error("Event is not available");
      if (await EventRegistration.countDocuments({ eventId: event._id, status: { $ne: "cancelled" } }) >= event.capacity) throw new Error("Event is full");
      record = await EventRegistration.findOneAndUpdate({ eventId: event._id, userId: user._id }, { status: "registered" }, { upsert: true, new: true });
    } else if (body.action === "event-attendance") {
      if (!user.libraryId || !["owner", "staff"].includes(user.role)) throw new Error("Library team access required");
      const value = z.object({ eventId: objectId, userId: objectId, attended: z.boolean() }).parse(data);
      if (!await LibraryEvent.exists({ _id: value.eventId, libraryId: user.libraryId })) throw new Error("Event not found");
      record = await EventRegistration.findOneAndUpdate({ eventId: value.eventId, userId: value.userId }, { status: value.attended ? "attended" : "registered" }, { new: true });
    } else throw new Error("Unsupported action");

    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return errorResponse(error);
  }
}
