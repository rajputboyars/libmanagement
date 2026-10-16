import { test } from "node:test";
import assert from "node:assert/strict";
// Run against a disposable MongoDB replica set, never a production database.
const enabled = !!process.env.TEST_MONGODB_URI;
test(
  "database integration: tenant scope, unique payment keys and concurrent seat writes",
  { skip: !enabled },
  async () => {
    process.env.MONGODB_URI = process.env.TEST_MONGODB_URI;
    const mongoose = (await import("mongoose")).default;
    const { db } = await import("../src/lib/db");
    const {
      Library,
      User,
      Seat,
      Payment,
      Membership,
      SeatAssignment,
      ExamCatalog,
      SyllabusNode,
      StudentExam,
      TopicProgress,
      RevisionSchedule,
      WeeklyLearningInsight,
      CoinTransaction,
      Reward,
    } =
      await import("../src/lib/models");
    await db();
    const email = `test-${Date.now()}@example.invalid`;
    const user = await User.create({
      name: "Integration Student",
      email,
      passwordHash: "not-a-login-hash",
    });
    const library = await Library.create({
      name: "Disposable integration library",
      ownerId: user._id,
    });
    try {
      const seat = await Seat.create({ libraryId: library._id, label: "T-1" });
      assert.equal(
        await Seat.countDocuments({ libraryId: new mongoose.Types.ObjectId() }),
        0,
      );
      const membership = await Membership.create({
        libraryId: library._id,
        userId: user._id,
        start: new Date(),
        end: new Date(Date.now() + 86400000),
        amount: 10000,
      });
      await Payment.init();
      const key = `integration-${Date.now()}`;
      await Payment.create({
        libraryId: library._id,
        membershipId: membership._id,
        userId: user._id,
        amount: 5000,
        method: "cash",
        key,
      });
      await assert.rejects(
        Payment.create({
          libraryId: library._id,
          membershipId: membership._id,
          userId: user._id,
          amount: 5000,
          method: "cash",
          key,
        }),
      );
      const allocate = async () => {
        const session = await mongoose.startSession();
        try {
          await session.withTransaction(async () => {
            await Library.updateOne(
              { _id: library._id },
              { $inc: { __v: 1 } },
              { session },
            );
            if (
              await SeatAssignment.exists({
                libraryId: library._id,
                seatId: seat._id,
              }).session(session)
            )
              throw new Error("conflict");
            await SeatAssignment.create(
              [
                {
                  libraryId: library._id,
                  seatId: seat._id,
                  userId: user._id,
                  start: new Date(),
                  end: new Date(Date.now() + 86400000),
                  shiftStart: 0,
                  shiftEnd: 1440,
                },
              ],
              { session },
            );
          });
        } finally {
          await session.endSession();
        }
      };
      const results = await Promise.allSettled([allocate(), allocate()]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);

      await Promise.all([ExamCatalog.init(), SyllabusNode.init(), StudentExam.init(), TopicProgress.init(), RevisionSchedule.init(), WeeklyLearningInsight.init(), CoinTransaction.init(), Reward.init()]);
      await ExamCatalog.create({ key: "upsc", title: "UPSC" });
      await assert.rejects(ExamCatalog.create({ key: "upsc", title: "Duplicate" }));
      const subject = await SyllabusNode.create({ examKey: "upsc", type: "subject", title: "General Studies", order: 1 });
      const topic = await SyllabusNode.create({ examKey: "upsc", parentId: subject._id, type: "topic", title: "Indian Polity", order: 1 });
      await assert.rejects(SyllabusNode.create({ examKey: "upsc", parentId: subject._id, type: "topic", title: "Indian Polity", order: 2 }));
      await StudentExam.create({ userId: user._id, examKey: "upsc", examDate: new Date(Date.now() + 86400000), weeklyMinutes: 600 });
      await assert.rejects(StudentExam.create({ userId: user._id, examKey: "neet", examDate: new Date(Date.now() + 86400000) }));
      await TopicProgress.create({ userId: user._id, topicId: topic._id, status: "completed", mastery: 60, completedAt: new Date() });
      await assert.rejects(TopicProgress.create({ userId: user._id, topicId: topic._id, status: "studying" }));
      const revision = await RevisionSchedule.create({ userId: user._id, topicId: topic._id, nextDueAt: new Date(), intervalIndex: 0 });
      revision.history.push({ reviewedAt: new Date(), confidence: 4, event: "review", scheduledFor: new Date(Date.now() + 86400000) });
      await revision.save();
      assert.equal(revision.history.length, 1);
      await WeeklyLearningInsight.create({ userId: user._id, week: "2026-10-12", examKey: "upsc", metrics: { accuracy: 50 }, recommendations: [], topicSignals: [], generatedAt: new Date() });
      await assert.rejects(WeeklyLearningInsight.create({ userId: user._id, week: "2026-10-12", examKey: "upsc", metrics: {}, recommendations: [], topicSignals: [], generatedAt: new Date() }));
      await CoinTransaction.create({ userId: user._id, libraryId: library._id, source: "verified:test", amount: 30, description: "Verified test activity" });
      await assert.rejects(CoinTransaction.create({ userId: user._id, libraryId: library._id, source: "verified:test", amount: 30, description: "Duplicate" }));
      const reward = await Reward.create({ libraryId: library._id, name: "Test notebook", kind: "stationery", coinCost: 20, stock: 1, budgetCoins: 20, budgetRemaining: 20, createdBy: user._id });
      const reserveReward = async (source: string) => {
        const spendSession = await mongoose.startSession();
        try {
          await spendSession.withTransaction(async () => {
            const updated = await Reward.updateOne({ _id: reward._id, stock: { $gt: 0 }, budgetRemaining: { $gte: 20 } }, { $inc: { stock: -1, budgetRemaining: -20 } }, { session: spendSession });
            if (!updated.modifiedCount) throw new Error("unavailable");
            await CoinTransaction.create([{ userId: user._id, libraryId: library._id, source, amount: -20, description: "Concurrent redemption" }], { session: spendSession });
          });
        } finally { await spendSession.endSession(); }
      };
      const redemptionResults = await Promise.allSettled([reserveReward("redeem:a"), reserveReward("redeem:b")]);
      assert.equal(redemptionResults.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal((await Reward.findById(reward._id))?.stock, 0);
    } finally {
      for (const model of [Payment, Membership, SeatAssignment, Seat])
        await model.deleteMany({ libraryId: library._id });
      await TopicProgress.deleteMany({ userId: user._id });
      await RevisionSchedule.deleteMany({ userId: user._id });
      await WeeklyLearningInsight.deleteMany({ userId: user._id });
      await CoinTransaction.deleteMany({ userId: user._id });
      await Reward.deleteMany({ libraryId: library._id });
      await StudentExam.deleteMany({ userId: user._id });
      await SyllabusNode.deleteMany({ examKey: "upsc" });
      await ExamCatalog.deleteMany({ key: "upsc" });
      await Library.deleteOne({ _id: library._id });
      await User.deleteOne({ _id: user._id });
      await mongoose.disconnect();
    }
  },
);
test("authentication signs and verifies expiring tokens", async () => {
  process.env.SESSION_SECRET = "test-only-secret-with-more-than-32-characters";
  const { issueSession, secret } = await import("../src/lib/auth");
  const { jwtVerify } = await import("jose");
  const token = await issueSession("student-123");
  const { payload } = await jwtVerify(token, secret());
  assert.equal(payload.sub, "student-123");
  assert.ok(payload.exp! > payload.iat!);
  await assert.rejects(
    jwtVerify(token, new TextEncoder().encode("wrong-secret")),
  );
});
