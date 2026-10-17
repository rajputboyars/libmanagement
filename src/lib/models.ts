import mongoose, { Schema, type SchemaDefinition } from "mongoose";
export const id = Schema.Types.ObjectId;
const tenant = { libraryId: { type: id, required: true, index: true } };
export function model(
  name: string,
  fields: SchemaDefinition,
  indexes: [Record<string, 1 | -1>, Record<string, unknown>][] = [],
) {
  const schema = new Schema(fields, { timestamps: true, strict: "throw" });
  for (const [keys, options] of indexes) schema.index(keys, options);
  return mongoose.models[name] || mongoose.model(name, schema);
}
export const User = model("User", {
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ["student", "owner", "staff", "super-admin"],
    default: "student",
  },
  libraryId: id,
  sessionVersion: { type: Number, default: 0 },
  invited: { type: Boolean, default: false },
  deletedAt: Date,
});
export const Library = model("Library", {
  name: { type: String, required: true },
  ownerId: { type: id, required: true },
  address: String,
  capacity: Number,
  plan: {
    type: String,
    enum: ["starter", "growth", "pro"],
    default: "starter",
  },
  subscriptionStatus: {
    type: String,
    enum: ["trial", "active", "paused"],
    default: "trial",
  },
  libraryCode: { type: String, uppercase: true, trim: true, unique: true, sparse: true },
  punchPolicy: { type: String, enum: ["app", "qr"], default: "app" },
  organizationId: { type: id, index: true },
  branchName: { type: String, default: "", trim: true, maxlength: 80 },
  publicSlug: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
  listingVisible: { type: Boolean, default: false, index: true },
  city: { type: String, default: "", trim: true, maxlength: 80, index: true },
  publicDescription: { type: String, default: "", trim: true, maxlength: 700 },
  facilities: [{ type: String, enum: ["wifi", "air-conditioning", "power-backup", "lockers", "drinking-water", "quiet-zone", "accessible-entry"] }],
});
export const StudentProfile = model("StudentProfile", {
  userId: { type: id, unique: true, required: true },
  libraryId: id,
  exam: String,
  goalMinutes: { type: Number, default: 120 },
  anonymous: { type: Boolean, default: true },
  restDays: [String],
});
export const Seat = model(
  "Seat",
  {
    ...tenant,
    label: { type: String, required: true },
    floor: { type: String, default: "Ground floor" },
    operationalStatus: { type: String, enum: ["available", "maintenance"], default: "available", index: true },
  },
  [[{ libraryId: 1, label: 1 }, { unique: true }]],
);
export const Shift = model("Shift", {
  ...tenant,
  name: String,
  start: { type: Number, min: 0, max: 1439 },
  end: { type: Number, min: 1, max: 1440 },
});
export const MembershipPlan = model("MembershipPlan", {
  ...tenant,
  name: String,
  amount: { type: Number, min: 0 },
  days: { type: Number, min: 1 },
  minutes: Number,
});
export const Membership = model("Membership", {
  ...tenant,
  userId: { type: id, required: true },
  planId: id,
  start: { type: Date, required: true },
  end: { type: Date, required: true },
  amount: { type: Number, min: 0, required: true },
  discount: { type: Number, default: 0 },
  paid: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ["active", "paused", "cancelled", "expired"],
    default: "active",
  },
  previousMembershipId: id,
});
export const SeatAssignment = model(
  "SeatAssignment",
  {
    ...tenant,
    seatId: { type: id, required: true },
    userId: { type: id, required: true },
    membershipId: id,
    start: { type: Date, required: true },
    end: { type: Date, required: true },
    shiftStart: Number,
    shiftEnd: Number,
  },
  [[{ libraryId: 1, seatId: 1, start: 1, end: 1 }, {}]],
);
export const Payment = model(
  "Payment",
  {
    ...tenant,
    membershipId: { type: id, required: true },
    userId: id,
    amount: { type: Number, min: 1, required: true },
    method: { type: String, enum: ["cash", "upi"], required: true },
    key: { type: String, required: true },
    receipt: String,
  },
  [[{ libraryId: 1, key: 1 }, { unique: true }]],
);
export const StudySession = model(
  "StudySession",
  {
    userId: { type: id, required: true },
    startedAt: Date,
    lastResumedAt: Date,
    activeSeconds: { type: Number, default: 0 },
    state: {
      type: String,
      enum: ["running", "paused", "complete"],
      default: "running",
    },
    completedAt: Date,
  },
  [
    [
      { userId: 1 },
      {
        unique: true,
        partialFilterExpression: { state: { $in: ["running", "paused"] } },
      },
    ],
  ],
);
export const XPTransaction = model(
  "XPTransaction",
  {
    userId: { type: id, required: true },
    source: { type: String, required: true },
    amount: { type: Number, required: true },
    day: String,
  },
  [
    [{ userId: 1, source: 1 }, { unique: true }],
    [{ userId: 1, day: 1 }, {}],
  ],
);
export const Notification = model("Notification", {
  libraryId: id,
  userId: id,
  title: String,
  message: String,
  read: { type: Boolean, default: false },
});
export const Expense = model("Expense", {
  ...tenant,
  title: String,
  amount: { type: Number, min: 0 },
  category: String,
  date: Date,
});
export const Attendance = model(
  "Attendance",
  {
    ...tenant,
    userId: id,
    day: String,
    checkIn: Date,
    checkOut: Date,
    // Every punch-in/out pair of the day. checkIn/checkOut keep the first in and last out for older screens and reports.
    sessions: [{ _id: false, inAt: { type: Date, required: true }, outAt: Date, method: { type: String, enum: ["app", "qr", "manual"], default: "app" }, auto: { type: Boolean, default: false } }],
  },
  [[{ libraryId: 1, userId: 1, day: 1 }, { unique: true }]],
);
export const Complaint = model("Complaint", {
  ...tenant,
  userId: id,
  title: String,
  message: String,
  status: { type: String, enum: ["open", "resolved"], default: "open" },
});
export const AuditLog = model("AuditLog", {
  ...tenant,
  actorId: id,
  action: String,
  recordId: id,
});
export const StaffMembership = model(
  "StaffMembership",
  { ...tenant, userId: id, permissions: [String] },
  [[{ libraryId: 1, userId: 1 }, { unique: true }]],
);
export const StudyGoal = model(
  "StudyGoal",
  { userId: id, day: String, minutes: Number },
  [[{ userId: 1, day: 1 }, { unique: true }]],
);
export const Achievement = model("Achievement", {
  key: { type: String, unique: true },
  title: String,
  description: String,
  threshold: Number,
});
export const StudentAchievement = model(
  "StudentAchievement",
  { userId: id, achievementId: id },
  [[{ userId: 1, achievementId: 1 }, { unique: true }]],
);
export const Quest = model("Quest", {
  key: { type: String, unique: true },
  title: String,
  target: Number,
  reward: Number,
  period: { type: String, enum: ["daily", "weekly"] },
});
export const QuestProgress = model(
  "QuestProgress",
  {
    userId: id,
    questId: id,
    period: String,
    progress: Number,
    claimed: { type: Boolean, default: false },
  },
  [[{ userId: 1, questId: 1, period: 1 }, { unique: true }]],
);

// Phase 2: learning graph, validated activity and private social features.
export const ExamCatalog = model("ExamCatalog", {
  key: { type: String, required: true, unique: true, lowercase: true, trim: true },
  title: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: "", maxlength: 500 },
  active: { type: Boolean, default: true, index: true },
  syllabusVersion: { type: String, default: "", trim: true, maxlength: 40 },
  syllabusSource: { type: String, default: "", trim: true, maxlength: 300 },
  syllabusVerifiedAt: Date,
});
export const SyllabusNode = model(
  "SyllabusNode",
  {
    examKey: { type: String, required: true, lowercase: true, index: true },
    parentId: { type: id, ref: "SyllabusNode", default: null, index: true },
    type: { type: String, enum: ["subject", "chapter", "topic"], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    order: { type: Number, default: 0, min: 0 },
    estimatedMinutes: { type: Number, default: 50, min: 10, max: 10000 },
    tags: [{ type: String, trim: true, maxlength: 40 }],
    active: { type: Boolean, default: true, index: true },
  },
  [
    [{ examKey: 1, parentId: 1, title: 1 }, { unique: true }],
    [{ examKey: 1, type: 1, order: 1 }, {}],
  ],
);
export const StudentExam = model("StudentExam", {
  userId: { type: id, required: true, unique: true, index: true },
  examKey: { type: String, required: true, lowercase: true },
  customExam: { type: String, default: "", trim: true, maxlength: 100 },
  examDate: { type: Date, required: true },
  weeklyMinutes: { type: Number, default: 600, min: 60, max: 5040 },
  subjectIds: [id],
  weakTopicIds: [id],
});
export const TopicProgress = model(
  "TopicProgress",
  {
    userId: { type: id, required: true, index: true },
    topicId: { type: id, required: true, index: true },
    status: { type: String, enum: ["not-started", "studying", "completed"], default: "not-started" },
    mastery: { type: Number, default: 0, min: 0, max: 100 },
    completedAt: Date,
    revisionLevel: { type: Number, default: 0, min: 0, max: 6 },
    nextRevisionAt: { type: Date, index: true },
    mockBest: { type: Number, default: 0, min: 0, max: 100 },
  },
  [[{ userId: 1, topicId: 1 }, { unique: true }]],
);
export const StudyPlan = model("StudyPlan", {
  userId: { type: id, required: true, index: true },
  examKey: { type: String, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  availability: { type: Schema.Types.Mixed, required: true },
  generatedBy: { type: String, enum: ["deterministic", "ai"], default: "deterministic" },
  status: { type: String, enum: ["active", "archived"], default: "active", index: true },
});
export const PlanTask = model(
  "PlanTask",
  {
    userId: { type: id, required: true, index: true },
    planId: { type: id, required: true, index: true },
    topicId: id,
    sourceTaskId: id,
    title: { type: String, required: true, trim: true, maxlength: 160 },
    kind: { type: String, enum: ["study", "revision", "mock", "rest"], required: true },
    scheduledFor: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, required: true, min: 0, max: 360 },
    status: { type: String, enum: ["pending", "completed", "missed", "rescheduled"], default: "pending", index: true },
    completedAt: Date,
  },
  [[{ userId: 1, scheduledFor: 1, status: 1 }, {}]],
);
export const Question = model(
  "Question",
  {
    examKey: { type: String, required: true, lowercase: true, index: true },
    subjectId: id,
    topicId: { type: id, index: true },
    prompt: { type: String, required: true, trim: true, maxlength: 1000 },
    options: { type: [String], required: true, validate: [(value: string[]) => value.length >= 2 && value.length <= 6, "2-6 options required"] },
    correctIndex: { type: Number, required: true, min: 0, select: false },
    explanation: { type: String, required: true, trim: true, maxlength: 1500 },
    difficulty: { type: String, enum: ["easy", "medium", "hard"], default: "medium" },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: id, required: true },
    status: { type: String, enum: ["draft", "in-review", "published", "archived"], default: "published", index: true },
    source: {
      name: { type: String, default: "", trim: true, maxlength: 120 },
      url: { type: String, default: "", trim: true, maxlength: 300 },
      year: { type: Number, min: 1950, max: 2100 },
      license: { type: String, enum: ["original", "licensed", "public-domain", "ai-generated", "unknown"], default: "original" },
      notes: { type: String, default: "", trim: true, maxlength: 300 },
    },
    aiGenerated: { type: Boolean, default: false },
    contentHash: { type: String, index: true },
    reviewedBy: id,
    reviewedAt: Date,
    publishedAt: Date,
  },
  [[{ examKey: 1, topicId: 1, active: 1 }, {}], [{ examKey: 1, status: 1, createdAt: -1 }, {}], [{ examKey: 1, contentHash: 1 }, { unique: true, sparse: true }]],
);
export const QuizAttempt = model(
  "QuizAttempt",
  {
    userId: { type: id, required: true, index: true },
    examKey: { type: String, required: true, index: true },
    questionIds: [id],
    rewardedQuestionIds: [id],
    answers: [{ questionId: id, selectedIndex: Number, correct: Boolean }],
    startedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    submittedAt: Date,
    state: { type: String, enum: ["active", "submitted", "expired"], default: "active", index: true },
    score: { type: Number, default: 0, min: 0 },
    accuracy: { type: Number, default: 0, min: 0, max: 100 },
    topicBreakdown: [Schema.Types.Mixed],
    xpGranted: { type: Number, default: 0, min: 0 },
  },
  [[{ userId: 1, createdAt: -1 }, {}]],
);
export const RevisionSchedule = model(
  "RevisionSchedule",
  {
    userId: { type: id, required: true, index: true },
    topicId: { type: id, required: true, index: true },
    intervalIndex: { type: Number, default: 0, min: 0, max: 5 },
    nextDueAt: { type: Date, required: true, index: true },
    lastReviewedAt: Date,
    snoozeCount: { type: Number, default: 0, min: 0, max: 3 },
    history: [{
      reviewedAt: Date,
      confidence: { type: Number, min: 1, max: 5 },
      event: { type: String, enum: ["review", "snooze", "reschedule"], default: "review" },
      previousDueAt: Date,
      scheduledFor: Date,
    }],
  },
  [
    [{ userId: 1, topicId: 1 }, { unique: true }],
    [{ userId: 1, nextDueAt: 1 }, {}],
  ],
);
export const WeeklyLearningInsight = model(
  "WeeklyLearningInsight",
  {
    userId: { type: id, required: true, index: true },
    week: { type: String, required: true },
    examKey: { type: String, required: true },
    metrics: { type: Schema.Types.Mixed, required: true },
    recommendations: { type: [Schema.Types.Mixed], required: true },
    topicSignals: { type: [Schema.Types.Mixed], required: true },
    generatedAt: { type: Date, required: true },
    version: { type: Number, default: 1 },
    summary: { type: Schema.Types.Mixed },
    narrative: { type: String, maxlength: 1000 },
    narrativeSource: { type: String, enum: ["deterministic", "ai"] },
  },
  [[{ userId: 1, week: 1 }, { unique: true }]],
);
export const LearningAudit = model(
  "LearningAudit",
  {
    userId: { type: id, required: true, index: true },
    action: { type: String, enum: ["revision-reviewed", "revision-snoozed", "revision-rescheduled", "insight-saved"], required: true },
    recordId: id,
    metadata: Schema.Types.Mixed,
  },
  [[{ userId: 1, createdAt: -1 }, {}]],
);
export const Doubt = model(
  "Doubt",
  {
    userId: { type: id, required: true, index: true },
    subject: { type: String, required: true, trim: true, maxlength: 60 },
    difficulty: { type: String, enum: ["foundation", "standard", "advanced"], required: true },
    question: { type: String, default: "", trim: true, maxlength: 3000 },
    image: {
      mime: { type: String, enum: ["image/png", "image/jpeg", "image/webp"] },
      data: { type: Buffer, select: false },
      size: Number,
    },
    provider: { type: String, enum: ["ollama", "fallback"], required: true },
    steps: [{ type: String, maxlength: 1200 }],
    hints: [{ type: String, maxlength: 800 }],
    answer: { type: String, required: true, maxlength: 5000 },
    disclaimer: { type: String, required: true, maxlength: 500 },
  },
  [[{ userId: 1, createdAt: -1 }, {}]],
);
export const AIUsage = model(
  "AIUsage",
  {
    userId: { type: id, required: true, index: true },
    day: { type: String, required: true },
    requests: { type: Number, default: 0, min: 0, max: 20 },
    providerRequests: { type: Number, default: 0, min: 0, max: 20 },
  },
  [[{ userId: 1, day: 1 }, { unique: true }]],
);
export const CoinTransaction = model(
  "CoinTransaction",
  {
    userId: { type: id, required: true, index: true },
    libraryId: { type: id, index: true },
    source: { type: String, required: true },
    amount: { type: Number, required: true, min: -100000, max: 1000 },
    description: { type: String, required: true, maxlength: 160 },
  },
  [
    [{ userId: 1, source: 1 }, { unique: true }],
    [{ userId: 1, createdAt: -1 }, {}],
  ],
);
export const Reward = model(
  "Reward",
  {
    ...tenant,
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: "", trim: true, maxlength: 300 },
    kind: { type: String, enum: ["snack", "stationery", "time-credit", "recognition", "other"], required: true },
    coinCost: { type: Number, required: true, min: 1, max: 100000 },
    stock: { type: Number, required: true, min: 0, max: 10000 },
    budgetCoins: { type: Number, required: true, min: 0, max: 10000000 },
    budgetRemaining: { type: Number, required: true, min: 0, max: 10000000 },
    redeemedCount: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: id, required: true },
  },
  [[{ libraryId: 1, active: 1, createdAt: -1 }, {}]],
);
export const RewardRedemption = model(
  "RewardRedemption",
  {
    ...tenant,
    rewardId: { type: id, required: true, index: true },
    userId: { type: id, required: true, index: true },
    coinCost: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["pending", "fulfilled", "cancelled"], default: "pending", index: true },
    code: { type: String, required: true, unique: true },
    fulfilledAt: Date,
    cancelledAt: Date,
  },
  [
    [{ userId: 1, createdAt: -1 }, {}],
    [{ libraryId: 1, status: 1, createdAt: -1 }, {}],
  ],
);
export const LibraryVisitRequest = model(
  "LibraryVisitRequest",
  {
    ...tenant,
    userId: { type: id, required: true, index: true },
    preferredAt: { type: Date, required: true },
    message: { type: String, default: "", trim: true, maxlength: 300 },
    status: { type: String, enum: ["pending", "approved", "declined", "visited", "cancelled"], default: "pending", index: true },
  },
  [[{ libraryId: 1, userId: 1, status: 1 }, {}]],
);
export const SeatWaitlist = model(
  "SeatWaitlist",
  {
    ...tenant,
    userId: { type: id, required: true, index: true },
    preferredSeatId: id,
    shiftId: { type: id, required: true },
    planId: { type: id, required: true },
    status: { type: String, enum: ["waiting", "offered", "accepted", "confirmed", "expired", "cancelled"], default: "waiting", index: true },
    offeredSeatId: id,
    offeredAt: Date,
    offerExpiresAt: { type: Date, index: true },
    acceptedAt: Date,
    confirmedAt: Date,
  },
  [
    [{ libraryId: 1, status: 1, createdAt: 1 }, {}],
    [{ userId: 1, status: 1, createdAt: -1 }, {}],
  ],
);
export const StudentGarden = model("StudentGarden", {
  userId: { type: id, required: true, unique: true },
  activePlantKey: { type: String, default: "fern" },
  growthPoints: { type: Number, default: 0, min: 0 },
  unlockedPlants: { type: [String], default: ["fern"] },
  unlockedMilestones: { type: [String], default: [] },
  lastCalculatedAt: Date,
});
export const GardenTransaction = model(
  "GardenTransaction",
  { userId: { type: id, required: true, index: true }, source: { type: String, required: true }, points: { type: Number, required: true, min: 0, max: 100 }, earnedAt: { type: Date, required: true, index: true } },
  [[{ userId: 1, source: 1 }, { unique: true }]],
);
export const Friendship = model("Friendship", {
  requesterId: { type: id, required: true, index: true },
  recipientId: { type: id, required: true, index: true },
  pairKey: { type: String, required: true, unique: true },
  status: { type: String, enum: ["pending", "accepted", "declined", "blocked"], default: "pending", index: true },
});
export const LearningChallenge = model("LearningChallenge", {
  creatorId: { type: id, required: true, index: true }, invitedUserIds: [id], participantIds: [id],
  title: { type: String, required: true, trim: true, maxlength: 100 },
  metric: { type: String, enum: ["focus-minutes", "topics", "quiz-accuracy"], required: true },
  target: { type: Number, required: true, min: 1, max: 10000 }, startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true, index: true },
  status: { type: String, enum: ["open", "active", "complete"], default: "open", index: true },
});
export const ChallengeProgress = model("ChallengeProgress", {
  challengeId: { type: id, required: true, index: true }, userId: { type: id, required: true, index: true }, value: { type: Number, default: 0, min: 0 }, completedAt: Date, rewardedAt: Date,
}, [[{ challengeId: 1, userId: 1 }, { unique: true }]]);
export const StudyRoom = model("StudyRoom", {
  hostId: { type: id, required: true, index: true }, libraryId: id,
  title: { type: String, required: true, trim: true, maxlength: 80 }, goalMinutes: { type: Number, required: true, min: 10, max: 240 },
  joinCode: { type: String, required: true, unique: true, uppercase: true },
  state: { type: String, enum: ["waiting", "running", "ended"], default: "waiting", index: true }, startsAt: Date, endedAt: Date,
});
export const RoomParticipant = model("RoomParticipant", {
  roomId: { type: id, required: true, index: true }, userId: { type: id, required: true, index: true },
  status: { type: String, enum: ["joined", "ready", "complete", "left"], default: "joined" }, joinedAt: { type: Date, default: Date.now }, completedAt: Date,
}, [[{ roomId: 1, userId: 1 }, { unique: true }]]);
export const LibraryFeedback = model("LibraryFeedback", {
  ...tenant, userId: { type: id, required: true, index: true }, kind: { type: String, enum: ["feedback", "complaint"], required: true },
  category: { type: String, enum: ["facilities", "noise", "cleanliness", "staff", "service", "other"], required: true },
  message: { type: String, required: true, trim: true, maxlength: 1200 }, status: { type: String, enum: ["open", "reviewing", "resolved"], default: "open", index: true },
  responses: [{ ownerId: id, message: { type: String, maxlength: 1200 }, createdAt: { type: Date, default: Date.now } }],
}, [[{ libraryId: 1, status: 1, createdAt: -1 }, {}]]);
export const LibraryEvent = model("LibraryEvent", {
  ...tenant, creatorId: { type: id, required: true }, type: { type: String, enum: ["quiz", "workshop", "study-challenge"], required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 }, description: { type: String, default: "", maxlength: 1000 },
  startsAt: { type: Date, required: true, index: true }, endsAt: { type: Date, required: true }, capacity: { type: Number, min: 1, max: 1000, default: 50 },
  status: { type: String, enum: ["draft", "published", "cancelled", "complete"], default: "draft", index: true },
}, [[{ libraryId: 1, status: 1, startsAt: 1 }, {}]]);
export const EventRegistration = model("EventRegistration", {
  eventId: { type: id, required: true, index: true }, userId: { type: id, required: true, index: true },
  status: { type: String, enum: ["registered", "attended", "cancelled"], default: "registered" },
}, [[{ eventId: 1, userId: 1 }, { unique: true }]]);

export const MaintenanceIssue = model(
  "MaintenanceIssue",
  {
    ...tenant,
    reporterId: { type: id, required: true },
    seatId: id,
    category: { type: String, enum: ["furniture", "electrical", "wifi", "cooling", "cleanliness", "safety", "other"], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: "", trim: true, maxlength: 800 },
    priority: { type: String, enum: ["low", "medium", "high", "urgent"], default: "medium" },
    status: { type: String, enum: ["open", "assigned", "in-progress", "resolved", "cancelled"], default: "open", index: true },
    assigneeId: id,
    seatOffline: { type: Boolean, default: false },
    costPaise: { type: Number, min: 0, max: 10000000, default: 0 },
    resolvedAt: Date,
    events: [{ _id: false, at: { type: Date, required: true }, actorId: { type: id, required: true }, status: { type: String, required: true }, note: { type: String, default: "", maxlength: 400 } }],
  },
  [
    [{ libraryId: 1, status: 1, priority: 1, createdAt: -1 }, {}],
    [{ reporterId: 1, createdAt: -1 }, {}],
    [{ libraryId: 1, seatId: 1, status: 1 }, {}],
  ],
);

// Phase 3: opt-in community and moderated success wall.
export const CommunityProfile = model(
  "CommunityProfile",
  {
    userId: { type: id, required: true, unique: true },
    libraryId: { type: id, required: true, index: true },
    optedIn: { type: Boolean, default: false },
    alias: { type: String, required: true, trim: true, minlength: 3, maxlength: 30 },
    ageBand: { type: String, enum: ["adult", "minor"], required: true },
    consentStatus: { type: String, enum: ["not-required", "pending", "approved", "rejected"], default: "not-required" },
    guardianName: { type: String, default: "", trim: true, maxlength: 80 },
    guardianContact: { type: String, default: "", trim: true, maxlength: 80, select: false },
    lookingForBuddy: { type: Boolean, default: false },
    mentorship: { type: String, enum: ["none", "seeking", "offering"], default: "none" },
    sharedGoal: { type: String, default: "", trim: true, maxlength: 140 },
    moderation: { type: String, enum: ["active", "suspended"], default: "active", index: true },
    moderationNote: { type: String, default: "", maxlength: 300 },
  },
  [[{ libraryId: 1, optedIn: 1, moderation: 1 }, {}]],
);
export const CommunityBlock = model(
  "CommunityBlock",
  { userId: { type: id, required: true }, blockedId: { type: id, required: true } },
  [[{ userId: 1, blockedId: 1 }, { unique: true }], [{ blockedId: 1 }, {}]],
);
export const CommunityLink = model(
  "CommunityLink",
  {
    ...tenant,
    kind: { type: String, enum: ["buddy", "mentorship"], required: true },
    fromId: { type: id, required: true, index: true },
    toId: { type: id, required: true, index: true },
    pairKey: { type: String, required: true },
    status: { type: String, enum: ["pending", "accepted", "declined", "ended"], default: "pending" },
  },
  [[{ pairKey: 1 }, { unique: true }]],
);
export const CommunityReport = model(
  "CommunityReport",
  {
    ...tenant,
    reporterId: { type: id, required: true },
    targetUserId: id,
    postId: id,
    reason: { type: String, enum: ["harassment", "unsafe-contact", "inappropriate", "spam", "privacy", "other"], required: true },
    detail: { type: String, default: "", trim: true, maxlength: 400 },
    status: { type: String, enum: ["open", "actioned", "dismissed"], default: "open", index: true },
    resolution: { type: String, default: "", maxlength: 300 },
    resolvedBy: id,
  },
  [[{ libraryId: 1, status: 1, createdAt: -1 }, {}], [{ reporterId: 1, targetUserId: 1, postId: 1 }, { unique: true }]],
);
export const SuccessPost = model(
  "SuccessPost",
  {
    ...tenant,
    userId: { type: id, required: true, index: true },
    milestoneType: { type: String, enum: ["focus-hours", "level", "streak"], required: true },
    milestoneValue: { type: Number, required: true },
    message: { type: String, default: "", trim: true, maxlength: 140 },
    visibility: { type: String, enum: ["private", "library", "public"], default: "private" },
    consentAt: { type: Date, required: true },
    status: { type: String, enum: ["published", "removed"], default: "published", index: true },
    removedReason: { type: String, default: "", maxlength: 300 },
  },
  [[{ userId: 1, milestoneType: 1, milestoneValue: 1 }, { unique: true }], [{ visibility: 1, status: 1, createdAt: -1 }, {}]],
);

// Phase 4: exam preparation engine.
const section = { name: { type: String, required: true, trim: true, maxlength: 60 }, subjectId: id, topicId: id, count: { type: Number, required: true, min: 1, max: 200 }, marks: { type: Number, default: 1, min: 0.25, max: 10 }, negative: { type: Number, default: 0, min: 0, max: 10 } };
export const TestTemplate = model(
  "TestTemplate",
  {
    examKey: { type: String, required: true, lowercase: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    kind: { type: String, enum: ["full", "sectional", "topic"], required: true },
    durationMinutes: { type: Number, required: true, min: 3, max: 360 },
    sections: { type: [section], validate: [(v: unknown[]) => v.length >= 1 && v.length <= 12, "1-12 sections"] },
    patternVersion: { type: String, default: "", trim: true, maxlength: 40 },
    instructions: { type: String, default: "", maxlength: 800 },
    status: { type: String, enum: ["draft", "published", "archived"], default: "draft", index: true },
    createdBy: { type: id, required: true },
  },
  [[{ examKey: 1, status: 1, kind: 1 }, {}]],
);
export const TestAttempt = model(
  "TestAttempt",
  {
    userId: { type: id, required: true },
    libraryId: id,
    templateId: id,
    examKey: { type: String, required: true },
    kind: { type: String, enum: ["full", "sectional", "topic", "daily", "mini"], required: true },
    title: { type: String, required: true },
    day: String,
    topicId: id,
    plan: [{ _id: false, questionId: id, section: String, marks: Number, negative: Number }],
    startedAt: { type: Date, required: true },
    deadline: { type: Date, required: true },
    cursor: { questionId: id, at: Date },
    state: { type: String, enum: ["in-progress", "scoring", "submitted"], default: "in-progress" },
    scoringAt: Date,
    submittedAt: Date,
    autoSubmitted: { type: Boolean, default: false },
    result: Schema.Types.Mixed,
    xpGranted: { type: Number, default: 0 },
  },
  [
    [{ userId: 1, state: 1, createdAt: -1 }, {}],
    [{ userId: 1, templateId: 1 }, { unique: true, partialFilterExpression: { state: { $in: ["in-progress", "scoring"] }, templateId: { $type: "objectId" } } }],
    [{ userId: 1, kind: 1, day: 1 }, { unique: true, partialFilterExpression: { kind: "daily" } }],
    [{ templateId: 1, state: 1, libraryId: 1 }, {}],
  ],
);
export const TestAnswer = model(
  "TestAnswer",
  {
    attemptId: { type: id, required: true },
    userId: { type: id, required: true },
    questionId: { type: id, required: true },
    selectedIndex: { type: Number, min: 0, max: 5, default: null },
    flagged: { type: Boolean, default: false },
    timeMs: { type: Number, default: 0, min: 0 },
  },
  [[{ attemptId: 1, questionId: 1 }, { unique: true }]],
);
export const MistakeEntry = model(
  "MistakeEntry",
  {
    userId: { type: id, required: true },
    questionId: { type: id, required: true },
    examKey: String,
    topicId: id,
    wrongCount: { type: Number, default: 1, min: 1 },
    lastWrongAt: { type: Date, required: true },
    status: { type: String, enum: ["open", "understood"], default: "open" },
    note: { type: String, default: "", maxlength: 600 },
    retries: [{ _id: false, at: Date, correct: Boolean }],
  },
  [[{ userId: 1, questionId: 1 }, { unique: true }], [{ userId: 1, status: 1, lastWrongAt: -1 }, {}]],
);
export const Flashcard = model(
  "Flashcard",
  {
    userId: { type: id, required: true },
    front: { type: String, required: true, trim: true, maxlength: 400 },
    back: { type: String, required: true, trim: true, maxlength: 800 },
    topicId: id,
    questionId: id,
    intervalIndex: { type: Number, default: 0, min: 0, max: 5 },
    nextDueAt: { type: Date, required: true },
    lapses: { type: Number, default: 0 },
    lastReviewedAt: Date,
    history: [{ _id: false, at: Date, confidence: Number }],
  },
  [[{ userId: 1, nextDueAt: 1 }, {}], [{ userId: 1, questionId: 1 }, { unique: true, sparse: true }]],
);
export const StudentNote = model(
  "StudentNote",
  {
    userId: { type: id, required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    body: { type: String, default: "", maxlength: 6000 },
    subjectId: id,
    topicId: id,
    tags: [{ type: String, trim: true, lowercase: true, maxlength: 30 }],
    bookmarked: { type: Boolean, default: false },
  },
  [[{ userId: 1, updatedAt: -1 }, {}], [{ userId: 1, bookmarked: 1 }, {}]],
);
export const ExamGoal = model(
  "ExamGoal",
  { userId: { type: id, required: true, index: true }, title: { type: String, required: true, trim: true, maxlength: 120 }, targetDate: Date, done: { type: Boolean, default: false }, doneAt: Date },
);
export const ExamDate = model(
  "ExamDate",
  {
    examKey: { type: String, required: true, lowercase: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    date: { type: Date, required: true },
    sourceName: { type: String, required: true, trim: true, maxlength: 120 },
    sourceUrl: { type: String, required: true, trim: true, maxlength: 300 },
    lastVerifiedAt: { type: Date, required: true },
    enteredBy: { type: id, required: true },
  },
  [[{ examKey: 1, date: 1 }, {}]],
);
