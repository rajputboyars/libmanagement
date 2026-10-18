import { Types } from "mongoose";
import { Attendance } from "./models";

export const STALE_SESSION_HOURS = 16;
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);
const oid = (v: unknown) => new Types.ObjectId(String(v));

export type Session = { inAt: Date | string; outAt?: Date | string | null; method?: string; auto?: boolean };

/** Minutes inside. Open sessions count up to `now`; sessions auto-closed because nobody punched out count as zero. */
export function sessionMinutes(sessions: Session[], now = new Date()) {
  return Math.round(sessions.reduce((sum, s) => {
    if (s.auto) return sum;
    const start = new Date(s.inAt).getTime(), end = s.outAt ? new Date(s.outAt).getTime() : now.getTime();
    return sum + Math.max(0, end - start) / 60000;
  }, 0));
}
export const openSession = (sessions: Session[]) => sessions.find((s) => !s.outAt);

/**
 * Library ID format: LIB- plus six characters from an alphabet without look-alikes (no 0/O, 1/I/L).
 * Input is forgiving about case, spaces and a missing dash.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function generateLibraryCode(random: (n: number) => number = (n) => Math.floor(Math.random() * n)) {
  return `LIB-${Array.from({ length: 6 }, () => ALPHABET[random(ALPHABET.length)]).join("")}`;
}
export function normalizeLibraryCode(input: string) {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = compact.startsWith("LIB") ? compact.slice(3) : compact;
  return /^[A-Z0-9]{6}$/.test(body) ? `LIB-${body}` : null;
}

// ── Database operations (single source of truth: the Attendance document, read by both the student and the library) ──

/** Closes sessions left open longer than the limit. They are flagged `auto` and count as zero minutes: the missed punch-out is visible, never guessed. */
export async function closeStaleSessions(filter: Record<string, unknown> = {}, now = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_SESSION_HOURS * 3600000);
  const res = await Attendance.collection.updateMany(
    { ...filter, sessions: { $elemMatch: { outAt: { $exists: false }, inAt: { $lt: cutoff } } } },
    [{ $set: { sessions: { $map: { input: "$sessions", as: "s", in: { $cond: [{ $and: [{ $not: ["$$s.outAt"] }, { $lt: ["$$s.inAt", cutoff] }] }, { $mergeObjects: ["$$s", { outAt: "$$s.inAt", auto: true }] }, "$$s"] } } } } }],
  );
  return res.modifiedCount;
}

export async function punchIn(input: { libraryId: unknown; userId: unknown; method: "app" | "qr" | "manual"; now?: Date }) {
  const now = input.now ?? new Date();
  const libraryId = oid(input.libraryId), userId = oid(input.userId);
  await closeStaleSessions({ libraryId, userId }, now);
  if (await Attendance.exists({ libraryId, userId, sessions: { $elemMatch: { outAt: { $exists: false } } } })) return { ok: false as const, reason: "already-in" as const };
  try {
    const doc = await Attendance.findOneAndUpdate(
      { libraryId, userId, day: dayKey(now), sessions: { $not: { $elemMatch: { outAt: { $exists: false } } } } },
      { $push: { sessions: { inAt: now, method: input.method } }, $setOnInsert: { checkIn: now } },
      { upsert: true, new: true },
    );
    return { ok: true as const, at: now, record: doc };
  } catch (error) {
    // Two simultaneous punch-ins: the unique (library, student, day) index lets exactly one create the day record.
    if ((error as { code?: number }).code === 11000) return { ok: false as const, reason: "already-in" as const };
    throw error;
  }
}

export async function punchOut(input: { libraryId: unknown; userId: unknown; now?: Date }) {
  const now = input.now ?? new Date();
  const doc = await Attendance.findOneAndUpdate(
    { libraryId: oid(input.libraryId), userId: oid(input.userId), sessions: { $elemMatch: { outAt: { $exists: false } } } },
    { $set: { "sessions.$.outAt": now, checkOut: now } },
    { sort: { day: -1 }, new: true },
  );
  return doc ? { ok: true as const, at: now, record: doc } : { ok: false as const, reason: "not-in" as const };
}

// ───────────────────────── Location check (geofence) ─────────────────────────
export const PUNCH_RADIUS_M = 100;
/** A reading less precise than this cannot prove the student is inside the radius. */
export const MAX_ACCURACY_M = 100;
export type Point = { lat: number; lng: number };

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: Point, b: Point) {
  const rad = (d: number) => (d * Math.PI) / 180, R = 6371000;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeoResult = { ok: true; distance: number } | { ok: false; reason: "no-location" | "inaccurate" | "outside"; distance?: number };
/** Checks a reading from the student's phone against the library's point. */
export function checkGeofence(fence: Point, reading?: { lat?: number; lng?: number; accuracy?: number }): GeoResult {
  if (reading?.lat === undefined || reading.lng === undefined) return { ok: false, reason: "no-location" };
  if (reading.accuracy !== undefined && reading.accuracy > MAX_ACCURACY_M) return { ok: false, reason: "inaccurate" };
  const distance = distanceMeters(fence, { lat: reading.lat, lng: reading.lng });
  return distance <= PUNCH_RADIUS_M ? { ok: true, distance } : { ok: false, reason: "outside", distance };
}
