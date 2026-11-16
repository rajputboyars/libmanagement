import { randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/** Desk QR codes are short-lived and unique: a photo of one is useless a couple of minutes later. */
export const QR_TTL_SECONDS = 120;
const EXPIRED = "That QR code has expired or is invalid. Scan the current code at the desk.";

export const signAttendanceToken = (libraryId: string, key: Uint8Array) =>
  new SignJWT({ libraryId, purpose: "attendance" }).setProtectedHeader({ alg: "HS256" }).setJti(randomUUID()).setIssuedAt().setExpirationTime(`${QR_TTL_SECONDS}s`).sign(key);

/** Returns the code's unique id. Codes without one (issued before this change) are rejected. */
export async function readAttendanceToken(token: string, key: Uint8Array, libraryId: string) {
  const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] }).catch(() => { throw new Error(EXPIRED); });
  if (payload.purpose !== "attendance" || payload.libraryId !== libraryId) throw new Error("This QR code is not for your library.");
  if (!payload.jti) throw new Error(EXPIRED);
  return payload.jti;
}
