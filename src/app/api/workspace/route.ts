import { reportUnexpected } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import {
  Library,
  User,
  Seat,
  Shift,
  MembershipPlan,
  Membership,
  SeatAssignment,
  Payment,
  Expense,
  Attendance,
  Complaint,
  Notification,
  AuditLog,
  StudySession,
  XPTransaction,
  StudentProfile,
  Achievement,
  StudentAchievement,
  Quest,
  QuestProgress,
  StaffMembership,
  StudentExam,
  ExamCatalog,
} from "@/lib/models";
import { punchIn } from "@/lib/punch";
import { studentPunchIn } from "@/lib/punch-flow";
import { JoinRequest } from "@/lib/ops-models";
import { nudgePartners } from "@/lib/partner-nudge";
import { studentAccessFor } from "@/lib/student-access-server";
import { PlanError, requireFeature, requireStudentRoom, assertWritable } from "@/lib/saas-server";
import { renewalTerms } from "@/lib/fees";
import { AccessError, accessFor, assertMember, assertTeam, can, moduleOn } from "@/lib/access";
import type { ModuleKey } from "@/lib/modules";
import type { PermissionKey } from "@/lib/permissions";
import { XP, reward, activeSeconds, focusLength, focusXP } from "@/lib/rules";

/** The student's chosen exam and date, for the home-screen countdown. */
async function examForCountdown(userId: unknown) {
  const e = await StudentExam.findOne({ userId }).select("examKey customExam examDate").lean<{ examKey: string; customExam?: string; examDate: Date }>();
  if (!e) return null;
  const catalog = e.customExam ? null : await ExamCatalog.findOne({ key: e.examKey }).select("title").lean<{ title: string }>();
  return { title: e.customExam || catalog?.title || e.examKey.toUpperCase(), date: new Date(e.examDate).toISOString().slice(0, 10) };
}
const schemas = {
  seats: z.object({
    label: z.string().min(1).max(20),
    floor: z.string().min(1).max(50),
  }),
  shifts: z
    .object({
      name: z.string().trim().min(1).max(60),
      start: z.number().int().min(0).max(1439),
      end: z.number().int().min(1).max(1440),
    })
    .refine((x) => x.end > x.start, "End must follow start"),
  plans: z.object({
    name: z.string().trim().min(1).max(80),
    amount: z.number().int().min(0),
    days: z.number().int().min(1).max(365),
  }),
  expenses: z.object({
    title: z.string().trim().min(1).max(120),
    amount: z.number().int().positive(),
    category: z.string().trim().max(40),
    date: z.iso.datetime(),
  }),
  complaints: z.object({
    title: z.string().trim().min(1).max(120),
    message: z.string().min(5).max(2000),
  }),
  notifications: z.object({
    title: z.string().trim().min(1).max(120),
    message: z.string().min(1).max(2000),
  }),
};
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const models = {
  seats: Seat,
  shifts: Shift,
  plans: MembershipPlan,
  memberships: Membership,
  payments: Payment,
  expenses: Expense,
  attendance: Attendance,
  complaints: Complaint,
  notifications: Notification,
};
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const owner = ["owner", "staff"].includes(user.role);
  const access = await accessFor(user);
  // What each list needs: its module must be on for the library, and staff need the matching permission.
  const READ: Record<string, [ModuleKey | null, PermissionKey]> = {
    seats: ["seats", "seats.view"], shifts: ["seats", "seats.view"], plans: ["memberships", "plans.view"], memberships: ["memberships", "memberships.view"],
    payments: ["fees", "fees.view"], expenses: ["expenses", "expenses.view"], attendance: ["attendance", "attendance.view"],
    complaints: ["feedback", "feedback.view"], students: [null, "students.view"],
  };
  const readable = (key: string) => {
    if (key === "notifications") return true;
    const rule = READ[key];
    if (!rule) return false;
    if (access.kind === "none") return false;
    if (rule[0] && !moduleOn(access, rule[0])) return false;
    return user.role !== "staff" || can(access, rule[1]);
  };
  const scope = owner ? { libraryId: user.libraryId } : { userId: user._id };
  const resource = req.nextUrl.searchParams.get("resource");
  if (resource) {
    if (
      !owner ||
      !readable(resource) ||
      !(Object.hasOwn(models, resource) || resource === "students")
    )
      return NextResponse.json(
        { error: "Resource unavailable" },
        { status: 403 },
      );
    const page = Math.max(
      1,
      Math.min(10000, Number(req.nextUrl.searchParams.get("page")) || 1),
    );
    const q = (req.nextUrl.searchParams.get("q") || "")
      .slice(0, 100)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const Model =
      resource === "students" ? User : models[resource as keyof typeof models];
    const search = q
      ? {
          $or: ["name", "email", "label", "title", "receipt"].map((key) => ({
            [key]: { $regex: q, $options: "i" },
          })),
        }
      : {};
    const filter = {
      libraryId: user.libraryId,
      ...(resource === "students" ? { role: "student" } : {}),
      ...search,
    };
    const [records, total] = await Promise.all([
      Model.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * 25)
        .limit(25)
        .lean(),
      Model.countDocuments(filter),
    ]);
    return NextResponse.json({ records, total, page, pageSize: 25 });
  }
  const entries = await Promise.all(
    Object.entries(models).map(async ([key, model]) => [
      key,
      readable(key)
        ? await model
            .find(
              key === "notifications" && !owner
                ? {
                    $or: [
                      { userId: user._id },
                      ...(user.libraryId
                        ? [
                            {
                              libraryId: user.libraryId,
                              userId: { $exists: false },
                            },
                          ]
                        : []),
                    ],
                  }
                : key === "seats" || key === "shifts" || key === "plans"
                  ? { libraryId: user.libraryId || null }
                  : scope,
            )
            .sort({ createdAt: -1 })
            .limit(key === "seats" ? 500 : 100)
            .lean()
        : [],
    ]),
  );
  const students =
    owner && readable("students")
      ? await User.find({ libraryId: user.libraryId, role: "student" })
          .limit(100)
          .lean()
      : [];
  const xp = await XPTransaction.find({ userId: user._id })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  const focus = await StudySession.findOne({
    userId: user._id,
    state: { $in: ["running", "paused"] },
  }).lean();
  const libraries =
    user.role === "super-admin" ? await Library.find().limit(100).lean() : [];
  const assignments = !readable("seats") && !readable("memberships") && owner ? [] : await SeatAssignment.find(
    owner ? { libraryId: user.libraryId } : { userId: user._id },
  )
    .limit(200)
    .lean();
  const audit =
    user.role === "owner"
      ? await AuditLog.find({ libraryId: user.libraryId })
          .sort({ createdAt: -1 })
          .limit(30)
          .lean()
      : [];
  const staff =
    user.role === "owner"
      ? await StaffMembership.find({ libraryId: user.libraryId }).lean()
      : [];
  const [revenue, expenses, balance, xpSum, seatCount, studentCount] =
    await Promise.all([
      readable("payments")
        ? Payment.aggregate([
            { $match: { ...scope, reversedAt: { $exists: false } } },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ])
        : [],
      readable("expenses")
        ? Expense.aggregate([
            { $match: scope },
            { $group: { _id: null, total: { $sum: "$amount" } } },
          ])
        : [],
      readable("memberships")
        ? Membership.aggregate([
            // Only memberships still running can owe money here: cancelled and expired ones are closed out.
            { $match: { ...scope, status: { $in: ["active", "paused"] }, end: { $gt: new Date() } } },
            {
              $group: {
                _id: null,
                total: {
                  $sum: {
                    $max: [
                      0,
                      { $subtract: [{ $subtract: ["$amount", { $ifNull: ["$discount", 0] }] }, { $ifNull: ["$paid", 0] }] },
                    ],
                  },
                },
              },
            },
          ])
        : [],
      XPTransaction.aggregate([
        { $match: { userId: user._id } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]),
      owner ? Seat.countDocuments({ libraryId: user.libraryId }) : 0,
      owner && readable("students")
        ? User.countDocuments({ libraryId: user.libraryId, role: "student" })
        : 0,
    ]);
  const summary = {
    revenue: revenue[0]?.total || 0,
    expenses: expenses[0]?.total || 0,
    due: balance[0]?.total || 0,
    xp: xpSum[0]?.total || 0,
    seats: seatCount,
    students: studentCount,
  };
  return NextResponse.json({
    summary,
    user,
    students,
    xp,
    focus,
    libraries,
    assignments,
    audit,
    staff,
    profile: await StudentProfile.findOne({ userId: user._id }).lean(),
    library: user.libraryId
      ? await Library.findById(user.libraryId).select("name hours holidays").lean()
      : null,
    studentAccess: await studentAccessFor(user),
    exam: user.role === "student" ? await examForCountdown(user._id) : null,
    ...Object.fromEntries(entries),
  });
}
export async function POST(req: NextRequest) {
  if (!validOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  if (!user)
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (limited(String(user._id), 60))
    return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  try {
    const body = await req.json();
    const action = z.string().parse(body.action);
    const owner = user.role === "owner";
    const libraryId = user.libraryId;
    if (action === "library-hours" || action === "holiday-add" || action === "holiday-remove") {
      if (!libraryId) return NextResponse.json({ error: "Only the library team can change timings" }, { status: 403 });
      await assertTeam(user, null, "settings.manage");
      await assertWritable(libraryId);
      if (action === "library-hours") {
        const hours = z
          .array(
            z
              .object({ day: z.number().int().min(0).max(6), open: z.number().int().min(0).max(1440), close: z.number().int().min(0).max(1440), closed: z.boolean() })
              .refine((h) => h.closed || h.close > h.open, "Closing time must be after opening time"),
          )
          .length(7)
          .refine((list) => new Set(list.map((h) => h.day)).size === 7, "Give timings for all 7 days")
          .parse(body.data?.hours);
        await Library.updateOne({ _id: libraryId }, { $set: { hours } });
      } else if (action === "holiday-add") {
        const h = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().trim().min(1).max(80) }).parse(body.data);
        await Library.updateOne({ _id: libraryId }, { $pull: { holidays: { date: h.date } } });
        await Library.updateOne({ _id: libraryId }, { $push: { holidays: { $each: [h], $sort: { date: 1 }, $slice: -60 } } });
      } else {
        const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(body.data?.date);
        await Library.updateOne({ _id: libraryId }, { $pull: { holidays: { date } } });
      }
      await AuditLog.create({ libraryId, actorId: user._id, action, recordId: libraryId });
      return NextResponse.json({ ok: true });
    }
    if (action === "platform.library") {
      if (user.role !== "super-admin")
        return NextResponse.json(
          { error: "Administrator permission required" },
          { status: 403 },
        );
      const data = z
        .object({
          id: objectId,
          plan: z.enum(["starter", "growth", "pro"]),
          subscriptionStatus: z.enum(["trial", "active", "paused"]),
        })
        .parse(body.data);
      const library = await Library.findByIdAndUpdate(
        data.id,
        { plan: data.plan, subscriptionStatus: data.subscriptionStatus },
        { new: true },
      );
      if (!library) throw new Error("Library not found");
      await AuditLog.create({
        libraryId: library._id,
        actorId: user._id,
        action: "platform.library",
        recordId: library._id,
      });
      return NextResponse.json({ ok: true });
    }
    if (action === "check-in") {
      if (user.role !== "student") throw new Error("This check-in code is not for your library");
      await assertMember(user, "attendance");
      const data = z.object({ token: z.string().max(2000), lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), accuracy: z.number().min(0).max(100000).optional() }).parse(body.data);
      await studentPunchIn(user, data);
      return NextResponse.json({ ok: true });
    }
    if (action === "rest-day") {
      const today = new Date().toISOString().slice(0, 10);
      const since = new Date(Date.now() - 6 * 86400000)
        .toISOString()
        .slice(0, 10);
      const profile = await StudentProfile.findOne({ userId: user._id });
      const rests: string[] = profile?.restDays || [];
      if (
        !rests.includes(today) &&
        rests.filter((day) => day >= since).length >= 2
      )
        throw new Error("Two rest days are available in each seven-day period");
      await StudentProfile.findOneAndUpdate(
        { userId: user._id },
        { $addToSet: { restDays: today } },
        { upsert: true },
      );
      return NextResponse.json({ ok: true });
    }
    if (action === "profile") {
      const data = z
        .object({
          exam: z.string().max(80),
          goalMinutes: z.number().int().min(25).max(480),
          anonymous: z.boolean(),
        })
        .parse(body.data);
      await StudentProfile.findOneAndUpdate({ userId: user._id }, data, {
        upsert: true,
      });
      return NextResponse.json({ ok: true });
    }
    if (action.startsWith("focus.")) {
      const session = await mongoose.startSession();
      let result;
      try {
        await session.withTransaction(async () => {
          await User.updateOne(
            { _id: user._id },
            { $inc: { __v: 1 } },
            { session },
          );
          let focus = await StudySession.findOne({
            userId: user._id,
            state: { $in: ["running", "paused"] },
          }).session(session);
          const now = new Date();
          if (action === "focus.start") {
            if (focus) throw new Error("A focus session is already active");
            [focus] = await StudySession.create(
              [
                {
                  userId: user._id,
                  startedAt: now,
                  lastResumedAt: now,
                  targetMinutes: focusLength(Number(body.data?.minutes)),
                  subject: String(body.data?.subject ?? "").trim().slice(0, 40),
                  topic: String(body.data?.topic ?? "").trim().slice(0, 60),
                },
              ],
              { session },
            );
          } else {
            if (!focus) throw new Error("Start a focus session first");
            const left = Math.min(50, Math.max(0, Math.floor(Number(body.data?.distractions) || 0)));
            if (action !== "focus.resume") focus.distractions = (focus.distractions ?? 0) + left;
            if (action === "focus.pause" && focus.state === "running") {
              focus.activeSeconds += Math.max(
                0,
                Math.floor((+now - +focus.lastResumedAt) / 1000),
              );
              focus.state = "paused";
            } else if (action === "focus.resume" && focus.state === "paused") {
              focus.lastResumedAt = now;
              focus.state = "running";
            } else if (action === "focus.complete") {
              const seconds = activeSeconds(focus, now);
              const target = focusLength(focus.targetMinutes);
              if (seconds < target * 60)
                throw new Error(`Complete ${target} active minutes to earn XP`);
              focus.state = "complete";
              focus.completedAt = now;
              const day = now.toISOString().slice(0, 10);
              const ledger = await XPTransaction.find({
                userId: user._id,
                day,
              }).session(session);
              const amount = reward(
                ledger.reduce((n, x) => n + x.amount, 0),
                focusXP(target),
              );
              await XPTransaction.create(
                [
                  {
                    userId: user._id,
                    source: `focus:${focus._id}`,
                    amount,
                    day,
                  },
                ],
                { session },
              );
              const count =
                (await StudySession.countDocuments({
                  userId: user._id,
                  state: "complete",
                  completedAt: { $gte: new Date(day) },
                }).session(session)) + 1;
              const profile = await StudentProfile.findOne({
                userId: user._id,
              }).session(session);
              let dailyXP = ledger.reduce((n, x) => n + x.amount, 0) + amount;
              const grant = async (source: string, value: number) => {
                if (
                  !(await XPTransaction.exists({
                    userId: user._id,
                    source,
                  }).session(session))
                ) {
                  const awarded = reward(dailyXP, value);
                  await XPTransaction.create(
                    [{ userId: user._id, source, amount: awarded, day }],
                    { session },
                  );
                  dailyXP += awarded;
                }
              };
              if (count * 25 >= (profile?.goalMinutes || 120))
                await grant(`goal:${day}`, XP.goal);
              const week = new Date(day);
              week.setUTCDate(week.getUTCDate() - ((week.getUTCDay() + 6) % 7));
              const weekKey = week.toISOString().slice(0, 10);
              const recent = await StudySession.find({
                userId: user._id,
                state: "complete",
                completedAt: { $gte: week },
              }).session(session);
              const days = new Set([
                ...recent.map((s) => s.completedAt.toISOString().slice(0, 10)),
                day,
              ]);
              if (days.size >= 5) await grant(`weekly:${weekKey}`, XP.weekly);
              const quest = await Quest.findOneAndUpdate(
                { key: "daily-focus" },
                {
                  $setOnInsert: {
                    title: "Find your flow",
                    target: 2,
                    reward: 0,
                    period: "daily",
                  },
                },
                { upsert: true, new: true, session },
              );
              await QuestProgress.findOneAndUpdate(
                { userId: user._id, questId: quest._id, period: day },
                { $set: { progress: Math.min(count, 2), claimed: count >= 2 } },
                { upsert: true, session },
              );
              const lifetime =
                (await StudySession.countDocuments({
                  userId: user._id,
                  state: "complete",
                }).session(session)) + 1;
              for (const [key, title, threshold] of [
                ["first-focus", "First steps", 1],
                ["ten-focus", "In the zone", 10],
              ] as const) {
                if (lifetime >= threshold) {
                  const achievement = await Achievement.findOneAndUpdate(
                    { key },
                    {
                      $setOnInsert: {
                        title,
                        threshold,
                        description: `Complete ${threshold} focus sessions`,
                      },
                    },
                    { upsert: true, new: true, session },
                  );
                  await StudentAchievement.updateOne(
                    { userId: user._id, achievementId: achievement._id },
                    {
                      $setOnInsert: {
                        userId: user._id,
                        achievementId: achievement._id,
                      },
                    },
                    { upsert: true, session },
                  );
                }
              }
            } else throw new Error("Invalid timer transition");
            await focus.save({ session });
          }
          result = focus;
        });
      } finally {
        await session.endSession();
      }
      if (action === "focus.complete") await nudgePartners(user).catch(() => undefined);
      return NextResponse.json({ ok: true, focus: result });
    }
    if (action === "complaints" && libraryId) {
      await assertMember(user, "feedback");
      const data = schemas.complaints.parse(body.data);
      await Complaint.create({ ...data, libraryId, userId: user._id });
      return NextResponse.json({ ok: true });
    }
    // Every team action names the module it belongs to and the permission it needs. Unknown actions are for owners only.
    const ACTIONS: Record<string, [ModuleKey | null, PermissionKey | "owner"]> = {
      seats: ["seats", "seats.create"], shifts: ["seats", "seats.create"],
      plans: ["memberships", "memberships.create"], memberships: ["memberships", "memberships.create"],
      "membership-status": ["memberships", "memberships.update"], renew: ["memberships", "memberships.update"],
      payments: ["fees", "fees.create"], "payment-reverse": ["fees", "fees.reverse"], expenses: ["expenses", "expenses.create"],
      attendance: ["attendance", "attendance.mark"], resolve: ["feedback", "feedback.respond"],
      notifications: [null, "notifications.create"], students: [null, "students.create"], staff: [null, "owner"],
    };
    const rule = ACTIONS[action];
    if (!libraryId || (!rule && !owner)) return NextResponse.json({ error: "Owner permission required" }, { status: 403 });
    if (rule) {
      if (rule[1] === "owner" && !owner) throw new AccessError("Only the library owner can do this", "forbidden");
      await assertTeam(user, rule[0], rule[1] === "owner" ? null : rule[1]);
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        let record;
        // Serialize tenant writes so simultaneous allocation/payment checks cannot race.
        await Library.updateOne(
          { _id: libraryId },
          { $inc: { __v: 1 } },
          { session },
        );
        // Collecting fees is part of the basic plan; expenses stay a paid-plan feature.
        if (action === "payments" || action === "payment-reverse") await requireFeature(libraryId, "basic", "Fee management");
        else if (action === "expenses") await requireFeature(libraryId, "fees-expenses", "Expense management");
        else if (action === "students") await requireStudentRoom(libraryId);
        else await assertWritable(libraryId);
        if (action === "staff") {
          if (!owner) throw new Error("Only owners can manage staff");
          const data = z
            .object({
              email: z.email(),
              permission: z.enum([
                "attendance",
                "students",
                "payments",
                "expenses",
                "none",
              ]),
            })
            .parse(body.data);
          const member = await User.findOne({
            email: data.email.toLowerCase(),
          }).session(session);
          if (
            !member ||
            member.role === "owner" ||
            member.role === "super-admin" ||
            // Only people who already joined this library (their own choice) can be made staff.
            String(member.libraryId ?? "") !== String(libraryId)
          )
            throw new Error(
              "Use an eligible registered account from this library",
            );
          if (
            await Membership.exists({
              userId: member._id,
              status: "active",
            }).session(session)
          )
            throw new Error(
              "An active student membership cannot become a staff account",
            );
          if (await StaffMembership.exists({ libraryId, userId: member._id, roleId: { $exists: true } }).session(session))
            throw new Error("This person has a role. Change their access under Team & roles.");
          member.role = data.permission === "none" ? "student" : "staff";
          member.libraryId = libraryId;
          await member.save({ session });
          record = await StaffMembership.findOneAndUpdate(
            { libraryId, userId: member._id },
            data.permission === "none"
              ? { $set: { permissions: [] } }
              : { $addToSet: { permissions: data.permission } },
            { upsert: true, new: true, session },
          );
        } else if (Object.hasOwn(schemas, action)) {
          const key = action as keyof typeof schemas;
          const data = schemas[key].parse(body.data);
          const Model = models[key];
          [record] = await Model.create([{ ...data, libraryId }], { session });
        } else if (action === "students") {
          const data = z
            .object({ email: z.email(), name: z.string().min(2) })
            .parse(body.data);
          const student = await User.findOne({
            email: data.email.toLowerCase(),
            role: "student",
          }).session(session);
          if (!student)
            throw new Error("Student must first register a StudyQuest account");
          if (String(student.libraryId ?? "") === String(libraryId))
            throw new Error("This student is already in your library");
          if (student.libraryId)
            throw new Error("Student belongs to another library");
          // The student joins only after accepting this invite.
          if (await JoinRequest.exists({ userId: student._id, status: "pending" }).session(session))
            throw new Error("This student already has a pending library request or invite");
          [record] = await JoinRequest.create(
            [{ libraryId, userId: student._id, invitedBy: user._id, message: data.name }],
            { session },
          );
          const library = await Library.findById(libraryId).select("name").session(session).lean<{ name: string }>();
          await Notification.create(
            [{ userId: student._id, title: "Library invite", message: `${library?.name ?? "A library"} invited you to join. Open My library to accept or decline.` }],
            { session },
          );
        } else if (action === "payments") {
          const data = z
            .object({
              membershipId: objectId,
              amount: z.number().int().positive(),
              method: z.enum(["cash", "upi"]),
              key: z.string().min(8).max(100),
            })
            .parse(body.data);
          const existing = await Payment.findOne({
            libraryId,
            key: data.key,
          }).session(session);
          if (existing) return;
          const membership = await Membership.findOne({
            _id: data.membershipId,
            libraryId,
          }).session(session);
          if (!membership) throw new Error("Membership not found");
          if (membership.status === "cancelled") throw new Error("This membership was cancelled, so no payment can be added to it");
          if (
            data.amount >
            membership.amount - membership.discount - membership.paid
          )
            throw new Error("Amount exceeds outstanding balance");
          [record] = await Payment.create(
            [
              {
                ...data,
                libraryId,
                userId: membership.userId,
                receipt: `SQ-${Date.now()}`,
              },
            ],
            { session },
          );
          membership.paid += data.amount;
          await membership.save({ session });
        } else if (action === "payment-reverse") {
          if (!owner) throw new Error("Only the library owner can reverse a payment");
          const data = z.object({ paymentId: objectId, reason: z.string().trim().min(3).max(200) }).parse(body.data);
          // Marking is conditional on "not reversed yet", so two simultaneous reversals cannot both succeed.
          record = await Payment.findOneAndUpdate(
            { _id: data.paymentId, libraryId, reversedAt: { $exists: false } },
            { $set: { reversedAt: new Date(), reversedBy: user._id, reversalReason: data.reason } },
            { new: true, session },
          );
          if (!record) throw new Error((await Payment.exists({ _id: data.paymentId, libraryId }).session(session)) ? "This payment was already reversed" : "Payment not found");
          const membership = await Membership.findOne({ _id: record.membershipId, libraryId }).session(session);
          if (!membership) throw new Error("Membership not found");
          membership.paid = Math.max(0, membership.paid - record.amount);
          await membership.save({ session });
        } else if (action === "memberships") {
          const data = z
            .object({
              userId: objectId,
              planId: objectId,
              seatId: objectId,
              start: z.iso.datetime(),
              shiftStart: z.number().int().min(0).max(1439),
              shiftEnd: z.number().int().min(1).max(1440),
              discount: z.number().int().min(0).default(0),
            })
            .parse(body.data);
          if (data.shiftEnd <= data.shiftStart)
            throw new Error("Invalid shift");
          const plan = await MembershipPlan.findOne({
            _id: data.planId,
            libraryId,
          }).session(session);
          const seat = await Seat.findOne({
            _id: data.seatId,
            libraryId,
          }).session(session);
          const student = await User.findOne({
            _id: data.userId,
            libraryId,
            role: "student",
          }).session(session);
          if (!plan || !seat || !student)
            throw new Error("Invalid student, plan or seat");
          if (seat.operationalStatus === "maintenance")
            throw new Error("Seat is out of service for maintenance");
          if (data.discount > plan.amount)
            throw new Error("Discount exceeds plan price");
          const start = new Date(data.start),
            end = new Date(+start + plan.days * 86400000);
          if (
            await SeatAssignment.exists({
              libraryId,
              seatId: data.seatId,
              start: { $lt: end },
              end: { $gt: start },
              shiftStart: { $lt: data.shiftEnd },
              shiftEnd: { $gt: data.shiftStart },
            }).session(session)
          )
            throw new Error("Seat is already assigned during this period");
          [record] = await Membership.create(
            [
              {
                libraryId,
                userId: data.userId,
                planId: data.planId,
                start,
                end,
                amount: plan.amount,
                discount: data.discount,
              },
            ],
            { session },
          );
          await SeatAssignment.create(
            [
              {
                libraryId,
                userId: data.userId,
                seatId: data.seatId,
                membershipId: record._id,
                start,
                end,
                shiftStart: data.shiftStart,
                shiftEnd: data.shiftEnd,
              },
            ],
            { session },
          );
        } else if (action === "membership-status") {
          const data = z
            .object({
              membershipId: objectId,
              status: z.enum(["active", "paused", "cancelled"]),
            })
            .parse(body.data);
          record = await Membership.findOne({
            _id: data.membershipId,
            libraryId,
          }).session(session);
          if (!record) throw new Error("Membership not found");
          if (record.status === "cancelled")
            throw new Error("Cancelled memberships cannot be reopened");
          record.status = data.status;
          await record.save({ session });
          // Paused memberships retain their reserved seat. Cancellation releases future availability.
          if (data.status === "cancelled")
            await SeatAssignment.updateMany(
              { libraryId, membershipId: record._id, end: { $gt: new Date() } },
              { $set: { end: new Date() } },
              { session },
            );
        } else if (action === "renew") {
          const data = z
            .object({
              membershipId: objectId,
              method: z.enum(["cash", "upi"]),
              confirmation: z.literal("RECEIVED"),
              key: z.string().min(8),
              discount: z.number().int().min(0).optional(),
            })
            .parse(body.data);
          if (
            await Payment.exists({ libraryId, key: data.key }).session(session)
          )
            return;
          const previous = await Membership.findOne({
            _id: data.membershipId,
            libraryId,
          }).session(session);
          if (!previous) throw new Error("Membership not found");
          if (previous.status === "cancelled") throw new Error("A cancelled membership cannot be renewed; create a new membership instead");
          if (previous.status === "paused") throw new Error("Resume this membership before renewing it");
          if (previous.amount - (previous.discount ?? 0) - (previous.paid ?? 0) > 0)
            throw new Error("Clear previous dues before renewing");
          const plan = await MembershipPlan.findOne({
            _id: previous.planId,
            libraryId,
          }).session(session);
          // The seat the student holds now: seat changes end the old assignment and start a new one under the same membership.
          const assignment = await SeatAssignment.findOne({
            membershipId: previous._id,
            libraryId,
          })
            .sort({ end: -1, start: -1 })
            .session(session);
          if (!plan || !assignment)
            throw new Error("Choose a new membership plan and seat");
          const seat = await Seat.findOne({ _id: assignment.seatId, libraryId }).session(session);
          if (!seat) throw new Error("The student's seat no longer exists; create a new membership instead");
          if (seat.operationalStatus === "maintenance") throw new Error(`Seat ${seat.label} is out of service for maintenance`);
          const terms = renewalTerms(plan, previous.discount, data.discount);
          const start = new Date(Math.max(+previous.end, Date.now())),
            end = new Date(+start + plan.days * 86400000);
          if (
            await Membership.exists({
              libraryId,
              previousMembershipId: previous._id,
            }).session(session)
          )
            throw new Error("This membership has already been renewed");
          if (
            await SeatAssignment.exists({
              libraryId,
              seatId: assignment.seatId,
              start: { $lt: end },
              end: { $gt: start },
              shiftStart: { $lt: assignment.shiftEnd },
              shiftEnd: { $gt: assignment.shiftStart },
            }).session(session)
          )
            throw new Error("Seat unavailable for renewal");
          [record] = await Membership.create(
            [
              {
                libraryId,
                userId: previous.userId,
                planId: plan._id,
                start,
                end,
                amount: plan.amount,
                discount: terms.discount,
                paid: terms.payable,
                previousMembershipId: previous._id,
              },
            ],
            { session },
          );
          await SeatAssignment.create(
            [
              {
                libraryId,
                seatId: assignment.seatId,
                userId: previous.userId,
                membershipId: record._id,
                start,
                end,
                shiftStart: assignment.shiftStart,
                shiftEnd: assignment.shiftEnd,
              },
            ],
            { session },
          );
          // A fully discounted renewal takes no money, so there is no payment to record.
          if (terms.payable > 0)
            await Payment.create(
              [
                {
                  libraryId,
                  membershipId: record._id,
                  userId: previous.userId,
                  amount: terms.payable,
                  method: data.method,
                  key: data.key,
                  receipt: `SQ-${Date.now()}`,
                },
              ],
              { session },
            );
        } else if (action === "attendance") {
          const data = z.object({ userId: objectId }).parse(body.data);
          if (
            !(await User.exists({
              _id: data.userId,
              libraryId,
              role: "student",
            }).session(session))
          )
            throw new Error("Student not found");
          record = (await punchIn({ libraryId, userId: data.userId, method: "manual" })).ok ? { ok: true } : { ok: true, alreadyInside: true };
        } else if (action === "resolve") {
          const data = z.object({ id: objectId }).parse(body.data);
          record = await Complaint.findOneAndUpdate(
            { _id: data.id, libraryId },
            { status: "resolved" },
            { new: true, session },
          );
        } else throw new Error("Unsupported action");
        if (record)
          await AuditLog.create(
            [{ libraryId, actorId: user._id, action, recordId: record._id }],
            { session },
          );
      });
    } finally {
      await session.endSession();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    reportUnexpected(error, "/api/workspace");
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Check all required fields"
            : error instanceof Error &&
                !/mongo|connection|server|buffer/i.test(error.message)
              ? error.message
              : "Unable to save. Check the database connection.",
        ...(error instanceof PlanError || error instanceof AccessError ? { code: error.code } : {}),
      },
      { status: error instanceof PlanError ? 402 : error instanceof AccessError ? error.status : 400 },
    );
  }
}
