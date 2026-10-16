import { Types } from "mongoose";
import { User } from "./models";
import { Organization, Referral, SubscriptionCredit } from "./saas-models";
import { referralVerdict } from "./saas";
import { audit, getSettings } from "./saas-server";

type Id = Types.ObjectId | string;
const monthStart = () => { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0, 0, 0, 0); return d; };

/** Records a referral for a newly created organization. Rejected referrals are kept for the audit trail but never earn credit. */
export async function attachReferral(referredOrgId: Id, code: string | undefined) {
  if (!code) return null;
  const settings = await getSettings();
  const referrer = await Organization.findOne({ referralCode: code.toUpperCase() }).lean<{ _id: Types.ObjectId; ownerId: Types.ObjectId }>();
  const referred = await Organization.findById(referredOrgId).lean<{ _id: Types.ObjectId; ownerId: Types.ObjectId }>();
  if (!referrer || !referred || !settings.referralEnabled) return null;
  const [a, b] = await Promise.all([User.findById(referrer.ownerId).select("email").lean<{ email: string }>(), User.findById(referred.ownerId).select("email").lean<{ email: string }>()]);
  const verdict = referralVerdict({
    referrerOrgId: String(referrer._id), referredOrgId: String(referred._id), referrerOwnerId: String(referrer.ownerId), referredOwnerId: String(referred.ownerId),
    referrerEmail: a?.email ?? "", referredEmail: b?.email ?? "", alreadyReferred: !!(await Referral.exists({ referredOrgId })), rewardedThisMonth: await Referral.countDocuments({ referrerOrgId: referrer._id, status: "rewarded", qualifiedAt: { $gte: monthStart() } }), monthlyCap: settings.referralMonthlyCap,
  });
  const record = await Referral.create({ referrerOrgId: referrer._id, referredOrgId, code: code.toUpperCase(), status: verdict ? "rejected" : "pending", rejectReason: verdict ?? "" });
  if (verdict) await audit({ organizationId: referrer._id, actorId: referred.ownerId, action: "referral.rejected", targetType: "referral", targetId: String(record._id), details: { reason: verdict } });
  return record;
}

/** Called after a payment is confirmed by a verified webhook. Only paid live invoices qualify; sandbox payments never earn credit. */
export async function evaluateReferral(referredOrgId: Id, paidLive: boolean) {
  if (!paidLive) return;
  const referral = await Referral.findOne({ referredOrgId, status: "pending" });
  if (!referral) return;
  const settings = await getSettings();
  const rewarded = await Referral.countDocuments({ referrerOrgId: referral.referrerOrgId, status: "rewarded", qualifiedAt: { $gte: monthStart() } });
  if (!settings.referralEnabled || settings.referralRewardPaise <= 0) return;
  if (rewarded >= settings.referralMonthlyCap) { referral.status = "rejected"; referral.rejectReason = "Monthly referral reward limit reached"; await referral.save(); return; }
  // Unique key makes the credit idempotent even if the payment event is replayed.
  const created = await SubscriptionCredit.updateOne({ key: `referral:${referral._id}` }, { $setOnInsert: { organizationId: referral.referrerOrgId, amountPaise: settings.referralRewardPaise, reason: "referral", note: `Referral ${referral.code}` } }, { upsert: true });
  referral.status = "rewarded"; referral.qualifiedAt = new Date(); await referral.save();
  if (created.upsertedCount) await audit({ organizationId: referral.referrerOrgId, actorId: referral.referredOrgId, actorRole: "system", action: "referral.rewarded", targetType: "referral", targetId: String(referral._id), details: { amountPaise: settings.referralRewardPaise } });
}

export async function creditBalance(organizationId: Id) {
  const rows = await SubscriptionCredit.aggregate([{ $match: { organizationId: new Types.ObjectId(String(organizationId)) } }, { $group: { _id: null, total: { $sum: "$amountPaise" } } }]);
  return rows[0]?.total ?? 0;
}
