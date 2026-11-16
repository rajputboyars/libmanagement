import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { User } from "./models";
import { db } from "./db";
import type { Types } from "mongoose";
import type { NextResponse } from "next/server";
import { requiresTwoFactor } from "./two-factor-policy";
export type AuthUser = {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: "student" | "owner" | "staff" | "super-admin";
  libraryId?: Types.ObjectId;
  sessionVersion?: number;
  deletedAt?: Date;
  suspendedAt?: Date;
  twoFactorEnabled?: boolean;
};
/**
 * Origins accepted for state-changing requests. Production and local runs accept exactly the canonical origin (APP_URL, or the request host when it is
 * unset). Only a Vercel PREVIEW deployment additionally accepts its own deployment URLs (they differ per deployment and cannot be known in advance);
 * VERCEL_ENV=production never does, so production origin validation is not weakened.
 */
export function allowedOrigins(request: Request, env: Record<string, string | undefined> = process.env) {
  const expected = env.APP_URL || `${new URL(request.url).protocol}//${request.headers.get("host")}`;
  const list = [new URL(expected).origin];
  if (env.VERCEL_ENV === "preview") for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL]) if (host && /^[a-z0-9.-]+$/i.test(host)) list.push(`https://${host}`);
  return list;
}
export function validOrigin(request: Request, env: Record<string, string | undefined> = process.env) {
  const origin = request.headers.get("origin");
  // Browsers always send Origin on cross-site writes; a missing Origin is only accepted from same-origin or non-browser callers.
  if (!origin) return request.headers.get("sec-fetch-site") !== "cross-site";
  return allowedOrigins(request, env).includes(origin);
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
    // Only real sessions are accepted. A two-step challenge (purpose "2fa") is signed with the same key but is never a session.
    if (payload.purpose) return null;
    await db();
    const user = await User.findById(payload.sub).lean<AuthUser>();
    // Sessions end when the account is deleted or its session version changes (password reset/change, sign out everywhere).
    if (!user || user.deletedAt || user.suspendedAt || (user.sessionVersion ?? 0) !== Number(payload.sv ?? 0)) return null;
    // Privileged accounts (owner, platform admin) without two-step sign-in have no usable session, whatever cookie they hold.
    // This is the single server-side gate: it also covers sessions issued before the policy and accounts that just gained a privileged role.
    if (requiresTwoFactor(user.role) && !user.twoFactorEnabled) return null;
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

/** The one place that sets the session cookie, so every sign-in path uses the same flags. */
export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set("sq-session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 604800 });
  return response;
}
/** A short-lived proof that the password step succeeded. It is not a session: it only unlocks the 2FA endpoints for its purpose. */
export type ChallengePurpose = "2fa" | "2fa-enroll";
export async function issueChallenge(userId: string, sessionVersion = 0, purpose: ChallengePurpose = "2fa") {
  return new SignJWT({ sv: sessionVersion, purpose }).setProtectedHeader({ alg: "HS256" }).setSubject(userId).setIssuedAt().setExpirationTime(purpose === "2fa" ? "5m" : "15m").sign(secret());
}
export async function readChallenge(token: string, purpose: ChallengePurpose = "2fa"): Promise<{ userId: string; sv: number } | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    if (payload.purpose !== purpose || !payload.sub) return null;
    return { userId: String(payload.sub), sv: Number(payload.sv ?? 0) };
  } catch {
    return null;
  }
}
/** Response for a privileged account that has not enrolled yet: no cookie, only a restricted enrolment token. */
export async function enrollmentRequired(user: { _id: unknown; role: string; sessionVersion?: number; twoFactorEnabled?: boolean }) {
  if (!requiresTwoFactor(user.role) || user.twoFactorEnabled) return null;
  return { twoFactorEnrollmentRequired: true, enrollmentToken: await issueChallenge(String(user._id), user.sessionVersion ?? 0, "2fa-enroll"), role: user.role };
}
