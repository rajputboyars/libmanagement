import type { Types } from "mongoose";
import { Notification, User } from "./models";
import { NotificationDelivery, Organization, OrganizationMembership } from "./saas-models";

type Id = Types.ObjectId | string;

export async function sendEmail(to: string, subject: string, text: string) {
  const url = process.env.EMAIL_WEBHOOK_URL;
  if (!url) return "not-configured" as const;
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...(process.env.EMAIL_WEBHOOK_TOKEN ? { Authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` } : {}) }, body: JSON.stringify({ to, subject, text }), signal: AbortSignal.timeout(10000) });
    return response.ok ? ("accepted" as const) : ("failed" as const);
  } catch {
    return "failed" as const;
  }
}
export async function sendSms(to: string, text: string) {
  const url = process.env.WHATSAPP_API_URL, token = process.env.WHATSAPP_API_TOKEN;
  if (!url || !token) return "not-configured" as const;
  try {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ to, text }), signal: AbortSignal.timeout(10000) });
    return response.ok ? ("accepted" as const) : ("failed" as const);
  } catch {
    return "failed" as const;
  }
}

/**
 * Notifies the organization owner. The idempotency key means a job that runs twice never sends twice.
 * Marketing messages are sent only to owners who opted in; transactional messages always reach the in-app inbox.
 */
export async function notifyOrg(input: { organizationId: Id; key: string; kind: string; title: string; message: string; marketing?: boolean }) {
  const org = await Organization.findById(input.organizationId).select("ownerId billingEmail").lean<{ ownerId: Types.ObjectId; billingEmail?: string }>();
  if (!org) return { sent: false as const, reason: "no-org" };
  const membership = await OrganizationMembership.findOne({ organizationId: input.organizationId, userId: org.ownerId }).select("marketingOptIn").lean<{ marketingOptIn: boolean }>();
  const owner = await User.findById(org.ownerId).select("email libraryId").lean<{ email: string; libraryId?: Types.ObjectId }>();
  const base = { organizationId: input.organizationId, userId: org.ownerId, kind: input.kind, marketing: !!input.marketing };
  if (input.marketing && !membership?.marketingOptIn) {
    await NotificationDelivery.updateOne({ key: `${input.key}:in-app` }, { $setOnInsert: { ...base, channel: "in-app", status: "skipped", error: "No marketing opt-in" } }, { upsert: true });
    return { sent: false as const, reason: "no-opt-in" };
  }
  const fresh = await NotificationDelivery.updateOne({ key: `${input.key}:in-app` }, { $setOnInsert: { ...base, channel: "in-app", status: "sent", attempts: 1 } }, { upsert: true });
  if (!fresh.upsertedCount) return { sent: false as const, reason: "duplicate" };
  await Notification.create({ userId: org.ownerId, libraryId: owner?.libraryId, title: input.title, message: input.message });
  const email = org.billingEmail || owner?.email;
  if (email) {
    const result = await sendEmail(email, input.title, input.message);
    await NotificationDelivery.updateOne({ key: `${input.key}:email` }, { $setOnInsert: { ...base, channel: "email", status: result === "accepted" ? "sent" : result === "failed" ? "failed" : "skipped", attempts: result === "not-configured" ? 0 : 1, error: result === "not-configured" ? "Email provider not configured" : result === "failed" ? "Provider error" : undefined } }, { upsert: true });
  }
  return { sent: true as const };
}

/** Retries failed external deliveries (bounded attempts). */
export async function retryFailedDeliveries(limit = 50) {
  const failed = await NotificationDelivery.find({ status: "failed", channel: "email", attempts: { $lt: 3 } }).limit(limit);
  let retried = 0;
  for (const d of failed) {
    const org = await Organization.findById(d.organizationId).select("billingEmail ownerId").lean<{ billingEmail?: string; ownerId: Types.ObjectId }>();
    const owner = org && (await User.findById(org.ownerId).select("email").lean<{ email: string }>());
    const note = await Notification.findOne({ userId: d.userId }).sort({ createdAt: -1 }).lean<{ title: string; message: string }>();
    const to = org?.billingEmail || owner?.email;
    if (!to || !note) continue;
    const result = await sendEmail(to, note.title, note.message);
    d.attempts += 1; d.status = result === "accepted" ? "sent" : "failed"; await d.save(); retried++;
  }
  return retried;
}
