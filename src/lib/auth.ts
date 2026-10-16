import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { User } from "./models";
import { db } from "./db";
import type { Types } from "mongoose";
export type AuthUser = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: "student" | "owner" | "staff" | "super-admin";
  libraryId?: Types.ObjectId;
  sessionVersion?: number;
  deletedAt?: Date;
};
export function validOrigin(request: Request) {
  const origin = request.headers.get("origin");
  // Browsers always send Origin on cross-site writes; a missing Origin is only accepted from same-origin or non-browser callers.
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  const expected =
    process.env.APP_URL ||
    `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  return origin === new URL(expected).origin;
}
export function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32)
    throw new Error("SESSION_SECRET must have at least 32 characters");
  return new TextEncoder().encode(value);
}
export async function issueSession(userId: string, sessionVersion = 0) {
  return new SignJWT({ sv: sessionVersion })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret());
}
export async function currentUser() {
  const token = (await cookies()).get("sq-session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), {
      algorithms: ["HS256"],
    });
    await db();
    const user = await User.findById(payload.sub).lean<AuthUser>();
    // Sessions end when the account is deleted or its session version changes (password reset/change, sign out everywhere).
    if (!user || user.deletedAt || (user.sessionVersion ?? 0) !== Number(payload.sv ?? 0)) return null;
    return user;
  } catch {
    return null;
  }
}
const buckets = new Map<string, { count: number; until: number }>();
export function limited(key: string, limit = 15) {
  const now = Date.now();
  if (buckets.size > 10000)
    for (const [k, v] of buckets) if (v.until < now) buckets.delete(k);
  const b = buckets.get(key);
  if (!b || b.until < now) {
    buckets.set(key, { count: 1, until: now + 60000 });
    return false;
  }
  b.count++;
  return b.count > limit;
}
