import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { z } from "zod";
import { jwtVerify } from "jose";
import { currentUser, limited, validOrigin, secret } from "@/lib/auth";
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
} from "@/lib/models";
import { punchIn } from "@/lib/punch";
import { PlanError, requireFeature, requireStudentRoom, assertWritable } from "@/lib/saas-server";
import { XP, reward, activeSeconds, focusLength, focusXP } from "@/lib/rules";
const schemas = {
  seats: z.object({
    label: z.string().min(1).max(20),
    floor: z.string().min(1).max(50),
  }),
  shifts: z
    .object({
      name: z.string().min(1),
      start: z.number().int().min(0).max(1439),
      end: z.number().int().min(1).max(1440),
    })
    .refine((x) => x.end > x.start, "End must follow start"),
  plans: z.object({
    name: z.string().min(1),
    amount: z.number().int().min(0),
    days: z.number().int().min(1).max(365),
  }),
  expenses: z.object({
    title: z.string().min(1),
    amount: z.number().int().positive(),
    category: z.string(),
    date: z.iso.datetime(),
  }),
  complaints: z.object({
    title: z.string().min(1),
    message: z.string().min(5).max(2000),
  }),
  notifications: z.object({
    title: z.string().min(1),
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
  const staffRecord =
    user.role === "staff"
      ? await StaffMembership.findOne({
          userId: user._id,
          libraryId: user.libraryId,
        })
      : null;
  const permissions: string[] = staffRecord?.permissions || [];
  const readable = (key: string) =>
    user.role !== "staff" ||
    ["seats", "shifts", "plans", "notifications"].includes(key) ||
    permissions.includes(key) ||
    (key === "memberships" && permissions.includes("payments")) ||
    (key === "students" &&
      (permissions.includes("attendance") || permissions.includes("payments")));
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
  const assignments = await SeatAssignment.find(
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
            { $match: scope },
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
            { $match: scope },
            {
              $group: {
                _id: null,
                total: {
                  $sum: {
                    $subtract: [
                      { $subtract: ["$amount", "$discount"] },
                      "$paid",
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
      const token = z.string().max(2000).parse(body.data?.token);
      const { payload } = await jwtVerify(token, secret(), {
        algorithms: ["HS256"],
      });
      if (
        payload.purpose !== "attendance" ||
        payload.libraryId !== String(libraryId) ||
        user.role !== "student"
      )
        throw new Error("This check-in code is not for your library");
      if (
        !(await Membership.exists({
          libraryId,
          userId: user._id,
          status: "active",
          start: { $lte: new Date() },
          end: { $gt: new Date() },
        }))
      )
        throw new Error("An active library membership is required");
      await punchIn({ libraryId, userId: user._id, method: "qr" });
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
                },
              ],
              { session },
            );
          } else {
            if (!focus) throw new Error("Start a focus session first");
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
      return NextResponse.json({ ok: true, focus: result });
    }
    if (action === "complaints" && libraryId) {
      const data = schemas.complaints.parse(body.data);
      await Complaint.create({ ...data, libraryId, userId: user._id });
      return NextResponse.json({ ok: true });
    }
    const staffPermission =
      user.role === "staff"
        ? await StaffMembership.findOne({ userId: user._id, libraryId })
        : null;
    if (
      (!owner && !staffPermission?.permissions.includes(action)) ||
      !libraryId
    )
      return NextResponse.json(
        { error: "Owner permission required" },
        { status: 403 },
      );
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
        if (action === "payments" || action === "expenses") await requireFeature(libraryId, "fees-expenses", "Fee and expense management");
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
            (member.libraryId && String(member.libraryId) !== String(libraryId))
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
          if (
            student.libraryId &&
            String(student.libraryId) !== String(libraryId)
          )
            throw new Error("Student belongs to another library");
          student.libraryId = libraryId;
          await student.save({ session });
          record = student;
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
        } else if (action === "memberships") {
          const data = z
            .object({
              userId: objectId,
              planId: objectId,
              seatId: objectId,
              start: z.iso.datetime(),
              shiftStart: z.number().min(0).max(1439),
              shiftEnd: z.number().min(1).max(1440),
              discount: z.number().min(0).default(0),
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
          if (previous.amount - previous.discount - previous.paid > 0)
            throw new Error("Clear previous dues before renewing");
          const plan = await MembershipPlan.findOne({
            _id: previous.planId,
            libraryId,
          }).session(session);
          const assignment = await SeatAssignment.findOne({
            membershipId: previous._id,
            libraryId,
          }).session(session);
          if (!plan || !assignment)
            throw new Error("Choose a new membership plan and seat");
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
                paid: plan.amount,
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
          await Payment.create(
            [
              {
                libraryId,
                membershipId: record._id,
                userId: previous.userId,
                amount: plan.amount,
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
    return NextResponse.json(
      {
        error:
          error instanceof z.ZodError
            ? "Check all required fields"
            : error instanceof Error &&
                !/mongo|connection|server|buffer/i.test(error.message)
              ? error.message
              : "Unable to save. Check the database connection.",
        ...(error instanceof PlanError ? { code: error.code } : {}),
      },
      { status: error instanceof PlanError ? 402 : 400 },
    );
  }
}
