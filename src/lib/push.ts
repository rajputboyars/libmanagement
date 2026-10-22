// Phone notifications through standard Web Push (VAPID). Optional: without keys nothing is sent.
import webpush from "web-push";
import { log } from "./log";
import { PushSubscription, User } from "./models";

type Sub = { endpoint: string; keys: { p256dh: string; auth: string } };
let configured: boolean | null = null;

export function pushPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function ready() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  configured = !!(pub && priv);
  if (configured) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:support@studyquest.app", pub!, priv!);
  return configured;
}

/** Sends one message to every saved phone of these users. Dead subscriptions (404/410) are removed. */
export async function pushToUsers(userIds: unknown[], message: { title: string; body: string; url: string }) {
  if (!ready() || !userIds.length) return 0;
  const subs = await PushSubscription.find({ userId: { $in: userIds } }).select("endpoint keys").limit(5000).lean<Sub[]>();
  const payload = JSON.stringify({ title: message.title, body: message.body.slice(0, 240), url: message.url });
  let sent = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload, { TTL: 86400, urgency: "normal" });
        sent++;
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) await PushSubscription.deleteOne({ endpoint: s.endpoint });
        else log("warn", "push.send.failed", { status });
      }
    }),
  );
  return sent;
}

/** Called after a Notification is created: personal ones go to that user, library-wide ones to its students. */
export async function pushForNotification(doc: { userId?: unknown; libraryId?: unknown; title?: string; message?: string }) {
  if (!ready()) return;
  const title = doc.title || "StudyQuest";
  const body = doc.message || "";
  if (doc.userId) {
    const user = await User.findById(doc.userId).select("role").lean<{ role: string }>();
    const url = user && ["owner", "staff"].includes(user.role) ? "/owner/notifications" : "/app/notifications";
    await pushToUsers([doc.userId], { title, body, url });
  } else if (doc.libraryId) {
    const students = await User.find({ libraryId: doc.libraryId, role: "student" }).select("_id").limit(5000).lean<{ _id: unknown }[]>();
    await pushToUsers(students.map((s) => s._id), { title, body, url: "/app/notifications" });
  }
}
