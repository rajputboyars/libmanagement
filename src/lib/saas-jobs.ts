import { BillingPayment, Organization, SaaSSubscription } from "./saas-models";
import { getSettings } from "./saas-server";
import { notifyOrg, retryFailedDeliveries } from "./saas-notify";

const day = 86400000;
const fmt = (d: Date) => d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

/**
 * Idempotent background work. Safe to run on any schedule or twice in a row: state changes are conditional
 * and every notification carries a unique key.
 */
export async function runJobs(now = new Date()) {
  const settings = await getSettings();
  const out = { expired: 0, trialReminders: 0, renewalReminders: 0, paymentAlerts: 0, onboardingReminders: 0, retried: 0 };
  const note = async (r: Awaited<ReturnType<typeof notifyOrg>>, field: keyof typeof out) => { if (r.sent) out[field]++; };

  // 1. Move lapsed subscriptions to expired (data is kept; entitlements already fall back to Free).
  const lapsed = await SaaSSubscription.find({
    $or: [
      { status: "trialing", trialEnd: { $lt: now } },
      { status: "active", source: { $in: ["credit", "admin"] }, currentPeriodEnd: { $lt: new Date(now.getTime() - settings.graceDays * day) } },
      { status: "past_due", pastDueSince: { $lt: new Date(now.getTime() - settings.graceDays * day) } },
      { status: "canceled", currentPeriodEnd: { $lt: now } },
    ],
  }).limit(500);
  for (const s of lapsed) {
    const reason = s.status === "trialing" ? "Trial ended" : s.status === "past_due" ? "Payment failed; grace period ended" : "Period ended";
    const wasTrial = s.status === "trialing";
    s.status = "expired"; s.history.push({ at: now, status: "expired", planKey: s.planKey, reason } as never); await s.save(); out.expired++;
    await note(await notifyOrg({ organizationId: s.organizationId as never, key: `expired:${s._id}:${now.toISOString().slice(0, 10)}`, kind: "subscription", title: wasTrial ? "Your trial has ended" : "Your subscription has ended", message: "Your data is safe and exportable. Free plan limits now apply; upgrade from Billing any time." }), "expired");
  }

  // 2. Trial reminders (3 days and 1 day before the end).
  for (const [days, tag] of [[3, "t3"], [1, "t1"]] as const) {
    const due = await SaaSSubscription.find({ status: "trialing", trialEnd: { $gt: now, $lte: new Date(now.getTime() + days * day) } }).limit(500).lean<{ organizationId: unknown; trialEnd: Date }[]>();
    for (const s of due) await note(await notifyOrg({ organizationId: s.organizationId as never, key: `${tag}:${s.organizationId}:${s.trialEnd.toISOString().slice(0, 10)}`, kind: "trial", title: days === 1 ? "Your trial ends tomorrow" : `Your trial ends on ${fmt(s.trialEnd)}`, message: "Choose a plan from Billing to keep QR attendance, fee management and reports. You can stay on Free with no payment." }), "trialReminders");
  }

  // 3. Period ends that will not auto-renew (cancelled, credit-funded or admin-granted).
  const ending = await SaaSSubscription.find({ status: { $in: ["active", "canceled"] }, currentPeriodEnd: { $gt: now, $lte: new Date(now.getTime() + 3 * day) }, $or: [{ cancelAtPeriodEnd: true }, { status: "canceled" }, { source: { $in: ["credit", "admin"] } }] }).limit(500).lean<{ organizationId: unknown; currentPeriodEnd: Date }[]>();
  for (const s of ending) await note(await notifyOrg({ organizationId: s.organizationId as never, key: `due:${s.organizationId}:${s.currentPeriodEnd.toISOString().slice(0, 10)}`, kind: "billing-due", title: `Your plan ends on ${fmt(s.currentPeriodEnd)}`, message: "It will not renew automatically. Renew from Billing to avoid losing paid features." }), "renewalReminders");

  // 4. Payment failure alerts with retry guidance.
  const failed = await BillingPayment.find({ status: "failed", createdAt: { $gt: new Date(now.getTime() - 7 * day) } }).limit(500).lean<{ _id: unknown; organizationId: unknown; failureReason?: string }[]>();
  for (const p of failed) await note(await notifyOrg({ organizationId: p.organizationId as never, key: `payfail:${p._id}`, kind: "payment-failed", title: "A subscription payment failed", message: `${p.failureReason || "The payment was declined."} Retry from Billing or use a different payment method. Paid features continue during a ${settings.graceDays}-day grace period.` }), "paymentAlerts");
  const pastDue = await SaaSSubscription.find({ status: "past_due", pastDueSince: { $exists: true } }).limit(500).lean<{ organizationId: unknown; pastDueSince: Date }[]>();
  for (const s of pastDue) await note(await notifyOrg({ organizationId: s.organizationId as never, key: `pastdue:${s.organizationId}:${s.pastDueSince.toISOString().slice(0, 10)}`, kind: "payment-failed", title: "Your subscription is past due", message: `Update your payment method by ${fmt(new Date(s.pastDueSince.getTime() + settings.graceDays * day))} to keep paid features.` }), "paymentAlerts");

  // 5. Onboarding reminders.
  for (const [hours, tag, text] of [[24, "d1", "Finish setting up your library: add seats, fee plans and students."], [72, "d3", "Your library setup is still incomplete. It takes a few minutes to finish."]] as const) {
    const stale = await Organization.find({ onboardingStatus: "pending", status: "active", createdAt: { $lt: new Date(now.getTime() - hours * 3600000) } }).select("_id").limit(500).lean<{ _id: unknown }[]>();
    for (const o of stale) await note(await notifyOrg({ organizationId: o._id as never, key: `onboard:${o._id}:${tag}`, kind: "onboarding", title: "Finish your StudyQuest setup", message: text }), "onboardingReminders");
  }

  out.retried = await retryFailedDeliveries();
  return out;
}
