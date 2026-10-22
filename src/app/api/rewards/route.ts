import { studentFeatureBlocked } from "@/lib/student-access-server";
import mongoose from "mongoose";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AuditLog, CoinTransaction, Reward, RewardRedemption } from "@/lib/models";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
async function balance(userId: unknown, session?: mongoose.ClientSession) {
  const rows = await CoinTransaction.aggregate([{ $match: { userId } }, { $group: { _id: null, total: { $sum: "$amount" } } }]).session(session || null);
  return rows[0]?.total || 0;
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "rewards"); if (blocked) return blocked; }
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!user.libraryId) return NextResponse.json({ rewards: [], redemptions: [], balance: 0, transactions: [] });
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const owner = ["owner", "staff"].includes(user.role);
  const [rewards, redemptions, transactions, coinBalance] = await Promise.all([
    Reward.find({ libraryId: user.libraryId, ...(owner ? {} : { active: true }) }).sort({ active: -1, createdAt: -1 }).limit(100).lean(),
    RewardRedemption.find(owner ? { libraryId: user.libraryId } : { userId: user._id }).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean(),
    owner ? [] : CoinTransaction.find({ userId: user._id }).sort({ createdAt: -1 }).limit(30).lean(),
    owner ? 0 : balance(user._id),
  ]);
  return NextResponse.json({ rewards, redemptions, transactions, balance: coinBalance, page });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "rewards"); if (blocked) return blocked; }
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!user.libraryId) return NextResponse.json({ error: "Join a library first" }, { status: 400 });
  if (limited(`rewards:${user._id}`, 30)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  try {
    const body = z.object({ action: z.enum(["reward-save", "redeem", "redemption-status"]), data: z.unknown() }).parse(await request.json());
    if (body.action === "reward-save") {
      if (!["owner", "staff"].includes(user.role)) throw new Error("Library team access required");
      const value = z.object({ id: objectId.optional(), name: z.string().trim().min(2).max(80), description: z.string().trim().max(300).default(""), kind: z.enum(["snack", "stationery", "time-credit", "recognition", "other"]), coinCost: z.number().int().min(1).max(100000), stock: z.number().int().min(0).max(10000), budgetCoins: z.number().int().min(0).max(10000000), active: z.boolean().default(true) }).parse(body.data);
      const prohibited = /cash|money transfer|withdraw|lottery|raffle|bet|gambl/i;
      if (prohibited.test(`${value.name} ${value.description}`)) throw new Error("Cash, transfers and chance-based rewards are not supported");
      let record;
      if (value.id) {
        const current = await Reward.findOne({ _id: value.id, libraryId: user.libraryId });
        if (!current) throw new Error("Reward not found");
        const spent = current.budgetCoins - current.budgetRemaining;
        if (value.budgetCoins < spent) throw new Error("Budget cannot be lower than coins already redeemed");
        record = await Reward.findOneAndUpdate({ _id: value.id, libraryId: user.libraryId }, { ...value, budgetRemaining: value.budgetCoins - spent }, { new: true, runValidators: true });
      } else record = await Reward.create({ ...value, libraryId: user.libraryId, budgetRemaining: value.budgetCoins, createdBy: user._id });
      await AuditLog.create({ libraryId: user.libraryId, actorId: user._id, action: "reward-save", recordId: record._id });
      return NextResponse.json({ ok: true, record });
    }
    if (body.action === "redeem") {
      if (user.role !== "student") throw new Error("Student access required");
      const value = z.object({ rewardId: objectId }).parse(body.data);
      const session = await mongoose.startSession();
      let redemption;
      try {
        await session.withTransaction(async () => {
          const reward = await Reward.findOne({ _id: value.rewardId, libraryId: user.libraryId, active: true, stock: { $gt: 0 } }).session(session);
          if (!reward || reward.budgetRemaining < reward.coinCost) throw new Error("Reward is unavailable");
          if (await balance(user._id, session) < reward.coinCost) throw new Error("Not enough Study Coins");
          [redemption] = await RewardRedemption.create([{ libraryId: user.libraryId, rewardId: reward._id, userId: user._id, coinCost: reward.coinCost, code: `SQ-${crypto.randomUUID().slice(0, 8).toUpperCase()}` }], { session });
          await CoinTransaction.create([{ userId: user._id, libraryId: user.libraryId, source: `redemption:${redemption._id}`, amount: -reward.coinCost, description: `Redeemed ${reward.name}` }], { session });
          const updated = await Reward.updateOne({ _id: reward._id, stock: { $gt: 0 }, budgetRemaining: { $gte: reward.coinCost } }, { $inc: { stock: -1, budgetRemaining: -reward.coinCost, redeemedCount: 1 } }, { session });
          if (!updated.modifiedCount) throw new Error("Reward became unavailable");
          await AuditLog.create([{ libraryId: user.libraryId, actorId: user._id, action: "reward-redeem", recordId: redemption._id }], { session });
        });
      } finally { await session.endSession(); }
      return NextResponse.json({ ok: true, record: redemption });
    }
    if (!["owner", "staff"].includes(user.role)) throw new Error("Library team access required");
    const value = z.object({ redemptionId: objectId, status: z.enum(["fulfilled", "cancelled"]) }).parse(body.data);
    const session = await mongoose.startSession();
    let record;
    try {
      await session.withTransaction(async () => {
        record = await RewardRedemption.findOne({ _id: value.redemptionId, libraryId: user.libraryId, status: "pending" }).session(session);
        if (!record) throw new Error("Pending redemption not found");
        record.status = value.status;
        if (value.status === "fulfilled") record.fulfilledAt = new Date();
        else {
          record.cancelledAt = new Date();
          await CoinTransaction.create([{ userId: record.userId, libraryId: user.libraryId, source: `refund:${record._id}`, amount: record.coinCost, description: "Cancelled reward refund" }], { session });
          await Reward.updateOne({ _id: record.rewardId, libraryId: user.libraryId }, { $inc: { stock: 1, budgetRemaining: record.coinCost, redeemedCount: -1 } }, { session });
        }
        await record.save({ session });
        await AuditLog.create([{ libraryId: user.libraryId, actorId: user._id, action: `redemption-${value.status}`, recordId: record._id }], { session });
      });
    } finally { await session.endSession(); }
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update rewards" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
