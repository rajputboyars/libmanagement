import { Notification, StudyPartner, StudySession, User } from "./models";
import { libraryClock } from "./library-hours";

/** After a focus session: nudge each accepted partner who has studied under 5 minutes today (once per pair per day). */
export async function nudgePartners(user: { _id: unknown; name: string }, now = new Date()) {
  const day = libraryClock(now).date;
  const since = new Date(Date.parse(`${day}T00:00:00Z`) - 330 * 60000);
  const links = await StudyPartner.find({ $or: [{ a: user._id }, { b: user._id }], status: "accepted" });
  for (const link of links) {
    if (link.lastNudge && libraryClock(link.lastNudge).date === day) continue;
    const other = String(link.a) === String(user._id) ? link.b : link.a;
    const rows = await StudySession.find({ userId: other, state: "complete", completedAt: { $gte: since } }).select("activeSeconds").lean<{ activeSeconds: number }[]>();
    if (rows.reduce((n, r) => n + r.activeSeconds, 0) >= 300) continue;
    if (!(await User.exists({ _id: other }))) continue;
    link.lastNudge = now;
    await link.save();
    await Notification.create({ userId: other, title: "Your study partner is studying", message: `${user.name.split(" ")[0]} just finished a focus session. Aapki baari! Start a session today.` });
  }
}
