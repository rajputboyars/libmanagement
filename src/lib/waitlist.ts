export const OFFER_HOURS = 24;
export const ACTIVE_WAITLIST_STATUSES = ["waiting", "offered", "accepted"] as const;

export type WaitlistEntry = { status: string; offerExpiresAt?: Date | string | null };

export function offerExpiry(from: Date) {
  return new Date(from.getTime() + OFFER_HOURS * 3600000);
}

/** An offered or accepted entry is stale once its offer window has passed. */
export function isStaleOffer(entry: WaitlistEntry, now: Date) {
  return ["offered", "accepted"].includes(entry.status) && !!entry.offerExpiresAt && new Date(entry.offerExpiresAt).getTime() <= now.getTime();
}

/** Position among still-waiting entries, 1-based, ordered by join time. */
export function queuePosition(entries: { id: string; status: string; createdAt: Date | string }[], id: string) {
  const waiting = entries.filter((entry) => entry.status === "waiting").sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const index = waiting.findIndex((entry) => entry.id === id);
  return index < 0 ? null : index + 1;
}
