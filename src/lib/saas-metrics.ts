import type { Types } from "mongoose";
import { Attendance, Library, Payment, Seat, SeatAssignment, User } from "./models";
import { AdmissionLead, BillingInvoice, BillingPayment, Organization, SaaSSubscription } from "./saas-models";
import { monthlyEquivalent, payingAt, rate } from "./saas";

export const METRIC_DEFINITIONS = {
  mrr: "Monthly recurring revenue: sum of monthly-equivalent plan prices (annual ÷ 12) for gateway-billed subscriptions that are active or past due. Excludes free, trial, credit-funded, sandbox and test organizations.",
  arr: "Annual recurring revenue = MRR × 12.",
  arpa: "Average revenue per account = MRR ÷ active paying organizations.",
  trialConversion: "Of organizations whose trial ended in the period, the share that made a verified paid payment.",
  churn: "Logo churn: organizations paying at the start of the period that were not paying at its end ÷ organizations paying at the start.",
  collected: "Verified captured payments in the period (gateway-confirmed), before refunds.",
  gross: "Invoice list price before discounts for invoices paid in the period.",
  netCollected: "Collected payments minus refunds on those payments. Tax shown separately (informational, from configured tax settings).",
  outstanding: "Total of open or failed invoices.",
  leadConversion: "Converted admission leads ÷ leads created in the period.",
  engagement: "Libraries with a membership payment or attendance record in the last 30 days ÷ all libraries.",
  seatUtilization: "Seats with an active assignment now ÷ operational seats.",
} as const;

type Id = Types.ObjectId;
export async function computeMetrics(opts: { from: Date; to: Date; includeSandbox?: boolean }) {
  const { from, to } = opts;
  const modes = opts.includeSandbox ? ["live", "sandbox", "credit"] : ["live"];
  const orgs = await Organization.find().select("isTest status createdAt").limit(20000).lean<{ _id: Id; isTest: boolean; status: string; createdAt: Date }[]>();
  const real = orgs.filter((o) => !o.isTest);
  const realIds = new Set(real.map((o) => String(o._id)));
  const subs = await SaaSSubscription.find({ organizationId: { $in: [...realIds] } }).lean<{ organizationId: Id; status: string; source: string; mode: string; interval: "monthly" | "annual"; planKey: string; planSnapshot: { monthlyPaise: number; annualPaise: number }; trialStart?: Date; trialEnd?: Date; history: { at: Date; status: string }[] }[]>();
  const paid = (s: (typeof subs)[number]) => s.source === "provider" && modes.includes(s.mode) && s.planSnapshot.monthlyPaise > 0;
  const paying = subs.filter((s) => paid(s) && ["active", "past_due"].includes(s.status));
  const mrr = paying.reduce((sum, s) => sum + monthlyEquivalent(s), 0);
  const byPlan = Object.entries(paying.reduce<Record<string, number>>((all, s) => ((all[s.planKey] = (all[s.planKey] ?? 0) + 1), all), {})).map(([plan, count]) => ({ plan, count }));

  const endedTrials = subs.filter((s) => s.trialEnd && s.trialEnd >= from && s.trialEnd <= to);
  const paidOrgs = new Set((await BillingPayment.find({ organizationId: { $in: endedTrials.map((s) => s.organizationId) }, status: { $in: ["captured", "partially_refunded", "refunded"] }, mode: { $in: modes.filter((m) => m !== "credit") } }).select("organizationId").lean<{ organizationId: Id }[]>()).map((p) => String(p.organizationId)));
  const converted = endedTrials.filter((s) => paidOrgs.has(String(s.organizationId))).length;

  const payingStart = subs.filter((s) => payingAt(s.history, from, paid(s)));
  const lost = payingStart.filter((s) => !payingAt(s.history, to, paid(s)));

  const inRange = { $gte: from, $lte: to };
  const [payments, invoicesPaid, outstanding, failedCount] = await Promise.all([
    BillingPayment.find({ organizationId: { $in: [...realIds] }, status: { $in: ["captured", "partially_refunded", "refunded"] }, mode: { $in: modes.filter((m) => m !== "credit") }, capturedAt: inRange }).select("amountPaise refundedPaise capturedAt").lean<{ amountPaise: number; refundedPaise: number; capturedAt: Date }[]>(),
    BillingInvoice.find({ organizationId: { $in: [...realIds] }, status: { $in: ["paid", "partially_refunded", "refunded"] }, mode: { $in: modes }, paidAt: inRange }).select("subtotalPaise discountPaise taxPaise totalPaise mode").lean<{ subtotalPaise: number; discountPaise: number; taxPaise: number; totalPaise: number; mode: string }[]>(),
    BillingInvoice.aggregate([{ $match: { organizationId: { $in: [...realIds].map((x) => new (BillingInvoice.base.Types.ObjectId)(x)) }, status: { $in: ["open", "failed"] }, mode: { $in: modes } } }, { $group: { _id: null, total: { $sum: "$totalPaise" }, n: { $sum: 1 } } }]),
    BillingPayment.countDocuments({ organizationId: { $in: [...realIds] }, status: "failed", mode: { $in: modes.filter((m) => m !== "credit") }, createdAt: inRange }),
  ]);
  const collected = payments.reduce((s, p) => s + p.amountPaise, 0), refunds = payments.reduce((s, p) => s + p.refundedPaise, 0);
  const cash = invoicesPaid.filter((i) => i.mode !== "credit");
  const series: { month: string; collectedPaise: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const start = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - i, 1)), end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - i + 1, 1));
    const rows = await BillingPayment.aggregate([{ $match: { organizationId: { $in: [...realIds].map((x) => new (BillingInvoice.base.Types.ObjectId)(x)) }, status: { $in: ["captured", "partially_refunded", "refunded"] }, mode: { $in: modes.filter((m) => m !== "credit") }, capturedAt: { $gte: start, $lt: end } } }, { $group: { _id: null, total: { $sum: { $subtract: ["$amountPaise", "$refundedPaise"] } } } }]);
    series.push({ month: start.toISOString().slice(0, 7), collectedPaise: rows[0]?.total ?? 0 });
  }

  const libs = await Library.find({ organizationId: { $in: [...realIds] } }).select("_id organizationId createdAt").lean<{ _id: Id; createdAt: Date }[]>();
  const libIds = libs.map((l) => l._id);
  const now = new Date(), since = new Date(now.getTime() - 30 * 86400000);
  const [students, seats, assigned, leads, activeLibsPay, activeLibsAtt] = await Promise.all([
    User.countDocuments({ role: "student", libraryId: { $in: libIds } }), Seat.countDocuments({ libraryId: { $in: libIds }, operationalStatus: { $ne: "maintenance" } }),
    SeatAssignment.distinct("seatId", { libraryId: { $in: libIds }, start: { $lte: now }, end: { $gt: now } }),
    AdmissionLead.find({ libraryId: { $in: libIds }, createdAt: inRange }).select("stage").lean<{ stage: string }[]>(),
    Payment.distinct("libraryId", { libraryId: { $in: libIds }, createdAt: { $gte: since } }), Attendance.distinct("libraryId", { libraryId: { $in: libIds }, checkIn: { $gte: since } }),
  ]);
  const activeLibs = new Set([...activeLibsPay, ...activeLibsAtt].map(String));
  const created = (arr: { createdAt: Date }[]) => arr.filter((x) => x.createdAt >= from && x.createdAt <= to).length;
  const span = to.getTime() - from.getTime();
  const prev = (arr: { createdAt: Date }[]) => arr.filter((x) => x.createdAt >= new Date(from.getTime() - span) && x.createdAt < from).length;

  return {
    period: { from, to }, includesSandbox: !!opts.includeSandbox, excludedTestOrganizations: orgs.length - real.length,
    revenue: { mrrPaise: mrr, arrPaise: mrr * 12, arpaPaise: paying.length ? Math.round(mrr / paying.length) : 0, activePayingOrganizations: paying.length, byPlan, collectedPaise: collected, refundsPaise: refunds, netCollectedPaise: collected - refunds, grossPaise: cash.reduce((s, i) => s + i.subtotalPaise, 0), discountsPaise: cash.reduce((s, i) => s + i.discountPaise, 0), taxPaise: cash.reduce((s, i) => s + i.taxPaise, 0), failedPayments: failedCount, outstandingPaise: outstanding[0]?.total ?? 0, outstandingInvoices: outstanding[0]?.n ?? 0, series },
    retention: { trialsEnded: endedTrials.length, trialsConverted: converted, trialConversionPct: rate(converted, endedTrials.length), payingAtStart: payingStart.length, churned: lost.length, churnPct: rate(lost.length, payingStart.length) },
    growth: { organizations: real.length, branches: libs.length, newOrganizations: created(real), previousNewOrganizations: prev(real), newBranches: created(libs), suspended: real.filter((o) => o.status === "suspended").length },
    usage: { activeStudents: students, seats, seatsInUse: assigned.length, seatUtilizationPct: rate(assigned.length, seats), leads: leads.length, convertedLeads: leads.filter((l) => l.stage === "converted").length, leadConversionPct: rate(leads.filter((l) => l.stage === "converted").length, leads.length), engagedLibraries: activeLibs.size, engagementPct: rate(activeLibs.size, libs.length) },
    definitions: METRIC_DEFINITIONS,
  };
}

/**
 * Privacy-conscious product metrics, derived only from operational records that already exist.
 * No new tracking, no free text, no per-student content: counts and rates only.
 */
export async function computeProductMetrics(now = new Date()) {
  const { StudySession, XPTransaction, Attendance: Att, Payment: Pay, Reward, MaintenanceIssue, CommunityProfile, TestAttempt, SeatWaitlist } = await import("./models");
  const { SupportTicket } = await import("./saas-models");
  const d = (n: number) => new Date(now.getTime() - n * 86400000);
  const orgs = await Organization.find({ isTest: false }).select("_id createdAt onboardingStatus").lean<{ _id: Id; createdAt: Date; onboardingStatus: string }[]>();
  const libs = await Library.find({ organizationId: { $in: orgs.map((o) => o._id) } }).select("_id organizationId").lean<{ _id: Id; organizationId: Id }[]>();
  const libOrg = new Map(libs.map((l) => [String(l._id), String(l.organizationId)]));
  const libIds = libs.map((l) => l._id);
  const [pay30, att30, pay60, att60] = await Promise.all([
    Pay.distinct("libraryId", { libraryId: { $in: libIds }, createdAt: { $gte: d(30) } }), Att.distinct("libraryId", { libraryId: { $in: libIds }, checkIn: { $gte: d(30) } }),
    Pay.distinct("libraryId", { libraryId: { $in: libIds }, createdAt: { $gte: d(60), $lt: d(30) } }), Att.distinct("libraryId", { libraryId: { $in: libIds }, checkIn: { $gte: d(60), $lt: d(30) } }),
  ]);
  const orgsOf = (ids: unknown[]) => new Set(ids.map((i) => libOrg.get(String(i))).filter(Boolean) as string[]);
  const active30 = orgsOf([...pay30, ...att30]), active60 = orgsOf([...pay60, ...att60]);
  const retained = [...active60].filter((o) => active30.has(o)).length;
  const old = orgs.filter((o) => o.createdAt < d(1));
  const newStudents = await User.find({ role: "student", libraryId: { $in: libIds }, createdAt: { $gte: d(30), $lt: d(7) } }).select("_id createdAt").lean<{ _id: Id; createdAt: Date }[]>();
  const sessions = await StudySession.find({ userId: { $in: newStudents.map((s) => s._id) } }).select("userId startedAt").lean<{ userId: Id; startedAt: Date }[]>();
  const firstUse = new Map<string, Date>();
  for (const s of sessions) { const k = String(s.userId); const cur = firstUse.get(k); if (!cur || s.startedAt < cur) firstUse.set(k, s.startedAt); }
  const activated = newStudents.filter((s) => { const f = firstUse.get(String(s._id)); return f && f.getTime() - s.createdAt.getTime() <= 7 * 86400000; }).length;
  const [wau, wauXp, goalXp, tickets, prepWeek] = await Promise.all([
    StudySession.distinct("userId", { startedAt: { $gte: d(7) } }), XPTransaction.distinct("userId", { createdAt: { $gte: d(7) } }),
    XPTransaction.countDocuments({ source: /^goal/, createdAt: { $gte: d(30) } }), SupportTicket.countDocuments({ createdAt: { $gte: d(30) } }), TestAttempt.distinct("userId", { createdAt: { $gte: d(7) } }),
  ]);
  const weekly = new Set([...wau, ...wauXp, ...prepWeek].map(String));
  const adoption = async (fn: () => Promise<unknown[]>) => orgsOf(await fn()).size;
  return {
    registrations: { last7: orgs.filter((o) => o.createdAt >= d(7)).length, last30: orgs.filter((o) => o.createdAt >= d(30)).length, total: orgs.length },
    onboarding: { completed: old.filter((o) => o.onboardingStatus === "complete").length, eligible: old.length, completionPct: rate(old.filter((o) => o.onboardingStatus === "complete").length, old.length) },
    libraries: { active30: active30.size, retention30to60Pct: rate(retained, active60.size), activeBase: active60.size },
    students: { weeklyActive: weekly.size, newCohort: newStudents.length, activated, activationPct: rate(activated, newStudents.length), goalBonusesAwarded30d: goalXp },
    support: { tickets30d: tickets },
    featureAdoption: {
      qrOrDailyAttendance: await adoption(() => Att.distinct("libraryId", { libraryId: { $in: libIds } })),
      crmLeads: await adoption(() => AdmissionLead.distinct("libraryId", { libraryId: { $in: libIds } })),
      rewards: await adoption(() => Reward.distinct("libraryId", { libraryId: { $in: libIds } })),
      maintenance: await adoption(() => MaintenanceIssue.distinct("libraryId", { libraryId: { $in: libIds } })),
      community: await adoption(() => CommunityProfile.distinct("libraryId", { libraryId: { $in: libIds } })),
      seatWaitlist: await adoption(() => SeatWaitlist.distinct("libraryId", { libraryId: { $in: libIds } })),
      multiBranch: new Set(libs.map((l) => String(l.organizationId))).size && [...libs.reduce((m, l) => m.set(String(l.organizationId), (m.get(String(l.organizationId)) ?? 0) + 1), new Map<string, number>()).values()].filter((n) => n > 1).length,
    },
    note: "Counts and rates from operational data only. No third-party trackers, no student content, no per-user event streams.",
  };
}
