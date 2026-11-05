import { Library, Membership } from "./models";
import { secret } from "./auth";
import { readAttendanceToken } from "./attendance-token";
import { assertInside, isInside, punchIn, type Fence } from "./punch";
import { limitedShared } from "./security";
import { assertWritable } from "./saas-server";

export async function activeMembership(userId: unknown, libraryId: unknown, now = new Date()) {
  return Membership.findOne({ userId, libraryId, status: "active", start: { $lte: now }, end: { $gt: now } }).select("end").lean<{ end: Date }>();
}

/**
 * The only way a student punches in (app punch screen and QR check-in page both end up here), so membership,
 * location and QR rules cannot be skipped by using a different endpoint.
 */
export async function studentPunchIn(user: { _id: unknown; libraryId?: unknown }, input: { token?: string; lat?: number; lng?: number; accuracy?: number }, now = new Date()) {
  if (!user.libraryId) throw new Error("Join a library first: enter your Library ID.");
  await assertWritable(user.libraryId as never);
  if (!(await activeMembership(user._id, user.libraryId, now))) throw new Error("Your library has not activated your membership yet. Once they verify you and allot a seat, you can punch in.");
  const library = await Library.findById(user.libraryId).select("punchPolicy geofence").lean<{ punchPolicy?: string; geofence?: Fence }>();
  assertInside(library?.geofence, input);
  // Already inside: nothing to record, and a repeated scan must not burn the code.
  if (await isInside(user.libraryId, user._id, now)) return { at: now, alreadyIn: true as const };
  let method: "app" | "qr" = "app";
  if (library?.punchPolicy === "qr" && !input.token) throw new Error("This library asks you to scan the QR code at the desk to punch in.");
  if (input.token) {
    const jti = await readAttendanceToken(input.token, secret(), String(user.libraryId));
    // One use per student per code, so a captured link cannot be replayed.
    if (await limitedShared(`qr:${jti}:${user._id}`, 1, 300)) throw new Error("This QR code was already used. Scan the current code at the desk.");
    method = "qr";
  }
  const r = await punchIn({ libraryId: user.libraryId, userId: user._id, method, now });
  return { at: now, alreadyIn: !r.ok };
}
