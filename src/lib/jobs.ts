import type { Types } from "mongoose";
import { Flashcard, Library, Membership, Notification, Payment, RevisionSchedule, User } from "./models";
import { BillingInvoice, BillingPayment, BillingWebhookEvent, NotificationDelivery, Organization } from "./saas-models";
import { JobRun } from "./ops-models";
import { runJobs as runSaasJobs } from "./saas-jobs";
import { reprocessEvent } from "./billing";
import { notifyOrg } from "./saas-notify";
import { limitedShared } from "./security";
import { alert, log } from "./log";

const day = 86400000;
const weekKey = (d: Date) => { const s = new Date(d); s.setUTCHours(0, 0, 0, 0); s.setUTCDate(s.getUTCDate() - ((s.getUTCDay() + 6) % 7)); return s.toISOString().slice(0, 10); };

/** Marks lapsed library memberships as expired. Records and payment history are untouched. */
async function membershipExpiry(now: Date) {
  const r = await Membership.updateMany({ status: "active", end: { $lt: now } }, { status: "expired" });
  return { expired: r.modifiedCount };
}

/** Weekly in-app reminder to students with an outstanding balance. Amounts come from stored membership figures only. */
async function feeDueReminders(now: Date) {
  const rows = await Membership.find({ status: { $in: ["active", "paused"] }, $expr: { $gt: [{ $subtract: [{ $subtract: ["$amount", { $ifNull: ["$discount", 0] }] }, { $ifNull: ["$paid", 0] }] }, 0] } }).select("userId libraryId amount discount paid end").limit(2000).lean<{ _id: Types.ObjectId; userId: Types.ObjectId; libraryId: Types.ObjectId; amount: number; discount?: number; paid?: number }[]>();
  let sent = 0;
  for (const m of rows) {
    const due = m.amount - (m.discount ?? 0) - (m.paid ?? 0);
    const key = `feedue:${m._id}:${weekKey(now)}`;
    const fresh = await NotificationDelivery.updateOne({ key }, { $setOnInsert: { userId: m.userId, channel: "in-app", kind: "fee-due", status: "sent", attempts: 1 } }, { upsert: true });
    if (!fresh.upsertedCount) continue;
    await Notification.create({ userId: m.userId, libraryId: m.libraryId, title: "Library fee due", message: `You have ₹${(due / 100).toLocaleString("en-IN")} outstanding. Please settle it with the library desk.` });
    sent++;
  }
  return { checked: rows.length, sent };
}

/** Daily nudge for revisions and flashcards that are due. One notification per student per day. */
async function revisionReminders(now: Date) {
  const dayKey = now.toISOString().slice(0, 10);
  const [rev, cards] = await Promise.all([
    RevisionSchedule.aggregate([{ $match: { nextDueAt: { $lte: now } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }, { $limit: 5000 }]),
    Flashcard.aggregate([{ $match: { nextDueAt: { $lte: now } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }, { $limit: 5000 }]),
  ]);
  const totals = new Map<string, { rev: number; cards: number }>();
  rev.forEach((r) => totals.set(String(r._id), { rev: r.n, cards: 0 }));
  cards.forEach((c) => { const t = totals.get(String(c._id)) ?? { rev: 0, cards: 0 }; t.cards = c.n; totals.set(String(c._id), t); });
  let sent = 0;
  for (const [userId, t] of totals) {
    const fresh = await NotificationDelivery.updateOne({ key: `revise:${userId}:${dayKey}` }, { $setOnInsert: { userId, channel: "in-app", kind: "revision", status: "sent", attempts: 1 } }, { upsert: true });
    if (!fresh.upsertedCount) continue;
    const user = await User.findById(userId).select("libraryId deletedAt").lean<{ libraryId?: Types.ObjectId; deletedAt?: Date }>();
    if (!user || user.deletedAt) continue;
    await Notification.create({ userId, libraryId: user.libraryId, title: "Time for a quick recall", message: `${t.rev ? `${t.rev} revision${t.rev === 1 ? "" : "s"}` : ""}${t.rev && t.cards ? " and " : ""}${t.cards ? `${t.cards} flashcard${t.cards === 1 ? "" : "s"}` : ""} ready to review.` });
    sent++;
  }
  return { students: totals.size, sent };
}

/**
 * Billing reconciliation: recovers events stuck mid-processing, retries failed events a bounded number of times,
 * and reports (never "fixes") inconsistencies between payments and invoices.
 */
async function billingReconciliation(now: Date) {
  const stuck = await BillingWebhookEvent.updateMany({ status: "processing", updatedAt: { $lt: new Date(now.getTime() - 10 * 60000) } }, { status: "failed", error: "Processing interrupted" });
  const retry = await BillingWebhookEvent.find({ status: "failed", attempts: { $lt: 5 } }).sort({ createdAt: 1 }).limit(50);
  let recovered = 0, stillFailing = 0;
  for (const e of retry) { try { await reprocessEvent(String(e._id)); recovered++; } catch { stillFailing++; } }
  const since = new Date(now.getTime() - 30 * day);
  const capturedNoInvoice = await BillingPayment.countDocuments({ status: { $in: ["captured", "partially_refunded", "refunded"] }, invoiceId: { $exists: false }, createdAt: { $gte: since } });
  const paidInvoices = await BillingInvoice.find({ status: "paid", mode: { $in: ["live", "sandbox"] }, createdAt: { $gte: since } }).select("providerPaymentId").lean<{ providerPaymentId?: string }[]>();
  const known = new Set((await BillingPayment.find({ providerPaymentId: { $in: paidInvoices.map((i) => i.providerPaymentId).filter(Boolean) as string[] } }).select("providerPaymentId").lean<{ providerPaymentId: string }[]>()).map((p) => p.providerPaymentId));
  const invoiceNoPayment = paidInvoices.filter((i) => i.providerPaymentId && !known.has(i.providerPaymentId)).length;
  const discrepancies = capturedNoInvoice + invoiceNoPayment;
  if (discrepancies || stillFailing) await alert("billing.reconciliation", { capturedNoInvoice, invoiceNoPayment, stillFailing });
  return { resetStuck: stuck.modifiedCount, recovered, stillFailing, discrepancies };
}

/** One summary per organization per week, sent the first time jobs run in that week. */
async function weeklyReports(now: Date) {
  const week = weekKey(now), since = new Date(now.getTime() - 7 * day);
  const orgs = await Organization.find({ status: "active", isTest: false }).select("_id").limit(2000).lean<{ _id: Types.ObjectId }[]>();
  let sent = 0;
  for (const o of orgs) {
    const libs = (await Library.find({ organizationId: o._id }).select("_id").lean<{ _id: Types.ObjectId }[]>()).map((l) => l._id);
    const [students, revenue] = await Promise.all([User.countDocuments({ role: "student", libraryId: { $in: libs } }), Payment.aggregate([{ $match: { libraryId: { $in: libs }, createdAt: { $gte: since } } }, { $group: { _id: null, t: { $sum: "$amount" } } }])]);
    const r = await notifyOrg({ organizationId: o._id, key: `weekly:${o._id}:${week}`, kind: "weekly-report", title: "Your weekly library summary", message: `${students} active students. ₹${((revenue[0]?.t ?? 0) / 100).toLocaleString("en-IN")} in fee payments recorded in the last 7 days.` });
    if (r.sent) sent++;
  }
  return { organizations: orgs.length, sent };
}

const JOBS: [string, (now: Date) => Promise<unknown>][] = [
  ["saas-jobs", (now) => runSaasJobs(now)],
  ["membership-expiry", membershipExpiry],
  ["fee-due-reminders", feeDueReminders],
  ["revision-reminders", revisionReminders],
  ["billing-reconciliation", billingReconciliation],
  ["weekly-reports", weeklyReports],
];

/**
 * Runs every job independently: one failure never blocks the others. Each run is recorded for the readiness heartbeat.
 * All jobs are idempotent, so overlapping or repeated runs are safe; the lock only avoids duplicated work.
 */
export async function runAllJobs(now = new Date(), opts: { force?: boolean } = {}) {
  if (!opts.force && (await limitedShared("job-lock:all", 0, 120))) return { skipped: "another run is in progress" as const, results: {} };
  const results: Record<string, unknown> = {};
  for (const [name, fn] of JOBS) {
    const startedAt = new Date();
    try {
      const result = await fn(now);
      results[name] = result;
      await JobRun.create({ name, status: "ok", startedAt, durationMs: Date.now() - startedAt.getTime(), result });
    } catch (error) {
      const message = error instanceof Error ? error.message : "error";
      results[name] = { error: message };
      await JobRun.create({ name, status: "failed", startedAt, durationMs: Date.now() - startedAt.getTime(), error: message.slice(0, 300) }).catch(() => null);
      log("error", "job.failed", { name, message });
      await alert("job.failed", { name, message });
    }
  }
  log("info", "jobs.completed", { results });
  return { results };
}
