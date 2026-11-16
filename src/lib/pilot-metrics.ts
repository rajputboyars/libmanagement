import { Attendance, Library, Membership, Payment, User } from "./models";
import { BillingPayment, BillingWebhookEvent, Organization, SupportTicket } from "./saas-models";
import { ConsentRecord } from "./ops-models";
import { latestConsents, termsNeedAcceptance } from "./legal";

/**
 * Pilot health metrics computed ONLY from counts: no names, emails, phone numbers, ids, free text or amounts leave the database.
 * Demo/test organizations are excluded. Organizations appear as "org-1", "org-2", ... in order of creation (a pseudonym, not an identifier),
 * and a library with fewer than `minGroup` active students is reported only inside the totals, so a tiny pilot cannot be re-identified
 * from a per-library row. Nothing here is collected from users' devices and nothing is stored: it is computed on demand from existing records.
 */
export async function pilotMetrics(opts: { now?: Date; minGroup?: number } = {}) {
  const now = opts.now ?? new Date(), minGroup = opts.minGroup ?? 3;
  const since = new Date(now.getTime() - 7 * 86400000), day7 = since.toISOString().slice(0, 10);
  const orgs = await Organization.find({ isTest: { $ne: true }, status: "active" }).sort({ createdAt: 1 }).select("_id").lean<{ _id: unknown }[]>();
  const orgIds = orgs.map((o) => o._id);
  const libs = await Library.find({ organizationId: { $in: orgIds } }).select("_id organizationId").lean<{ _id: unknown; organizationId: unknown }[]>();
  const libIds = libs.map((l) => l._id);
  const [owners, ownersWithSecondFactor, students, activeMembers, attendance7d, payments7d, tickets, failedEvents, rejectedEvents, review, consentRows, usersTotal] = await Promise.all([
    User.countDocuments({ role: "owner", libraryId: { $in: libIds } }),
    User.countDocuments({ role: "owner", libraryId: { $in: libIds }, twoFactorEnabled: true }),
    User.countDocuments({ role: "student", libraryId: { $in: libIds }, deletedAt: { $exists: false } }),
    Membership.distinct("userId", { libraryId: { $in: libIds }, status: "active", end: { $gte: now } }),
    Attendance.countDocuments({ libraryId: { $in: libIds }, day: { $gte: day7 } }),
    Payment.countDocuments({ libraryId: { $in: libIds }, createdAt: { $gte: since }, reversedAt: { $exists: false } }),
    SupportTicket.aggregate([{ $match: { organizationId: { $in: orgIds }, status: { $in: ["open", "pending"] } } }, { $group: { _id: "$priority", n: { $sum: 1 } } }]),
    BillingWebhookEvent.countDocuments({ status: "failed" }),
    BillingWebhookEvent.countDocuments({ status: "rejected" }),
    BillingPayment.countDocuments({ needsReview: true, organizationId: { $in: orgIds } }),
    ConsentRecord.find({ kind: "terms" }).select("userId kind version accepted createdAt").lean<{ userId: unknown; kind: string; version: string; accepted: boolean; createdAt: Date }[]>(),
    User.countDocuments({ libraryId: { $in: libIds }, deletedAt: { $exists: false } }),
  ]);
  const perUser = new Map<string, typeof consentRows>();
  for (const r of consentRows) { const k = String(r.userId); (perUser.get(k) ?? perUser.set(k, []).get(k)!).push(r); }
  let current = 0;
  for (const rows of perUser.values()) if (!termsNeedAcceptance(rows) && latestConsents(rows).get("terms")?.accepted) current++;
  const perOrg: { org: string; students: number; activeMembers: number; attendance7d: number; payments7d: number }[] = [];
  let i = 0;
  for (const o of orgs) {
    i++;
    const ids = libs.filter((l) => String(l.organizationId) === String(o._id)).map((l) => l._id);
    const [s, a, att, pay] = await Promise.all([
      User.countDocuments({ role: "student", libraryId: { $in: ids }, deletedAt: { $exists: false } }),
      Membership.distinct("userId", { libraryId: { $in: ids }, status: "active", end: { $gte: now } }).then((x) => x.length),
      Attendance.countDocuments({ libraryId: { $in: ids }, day: { $gte: day7 } }),
      Payment.countDocuments({ libraryId: { $in: ids }, createdAt: { $gte: since }, reversedAt: { $exists: false } }),
    ]);
    if (a >= minGroup) perOrg.push({ org: `org-${i}`, students: s, activeMembers: a, attendance7d: att, payments7d: pay });
  }
  const t = (p: string) => tickets.find((x: { _id: string; n: number }) => x._id === p)?.n ?? 0;
  return {
    generatedAt: now.toISOString(), window: "last 7 days", note: "counts only; demo/test organizations excluded; libraries with fewer than " + minGroup + " active members appear only in totals",
    organizations: orgs.length, libraries: libs.length,
    owners: { total: owners, twoFactorEnrolled: ownersWithSecondFactor },
    students: { total: students, withActiveMembership: activeMembers.length },
    activity: { attendanceRecords7d: attendance7d, paymentsRecorded7d: payments7d },
    support: { openHigh: t("high"), openNormal: t("normal"), openLow: t("low") },
    billing: { failedWebhookEvents: failedEvents, rejectedWebhookEvents: rejectedEvents, paymentsNeedingReview: review },
    legal: { usersWithCurrentTermsAccepted: current, usersTotal },
    perOrganization: perOrg,
  };
}
