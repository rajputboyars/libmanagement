import { createHash, randomBytes } from "node:crypto";
import { RateLimit } from "./ops-models";
import { log } from "./log";

/** Vercel overwrites X-Forwarded-For, so it is trusted there unless TRUST_PROXY=0 says otherwise. */
export const proxyTrusted = () => process.env.TRUST_PROXY === "1" || (process.env.TRUST_PROXY !== "0" && process.env.VERCEL === "1");
/** Placeholder returned when no trusted proxy tells us the caller's address. Never use it as a shared rate-limit bucket. */
export const DIRECT_IP = "direct";
/**
 * Client IP for rate limiting. Forwarded headers are client-controlled unless a trusted proxy sets them,
 * so they are only honoured behind a trusted proxy. Otherwise this returns DIRECT_IP and per-IP limits must be skipped
 * (or heavily relaxed), because every caller would share one bucket and a single attacker could lock everyone out.
 */
export function clientIp(request: Request) {
  if (proxyTrusted()) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
    return (forwarded && forwarded[forwarded.length - 1]) || request.headers.get("x-real-ip") || DIRECT_IP;
  }
  return DIRECT_IP;
}
/** Per-IP limit: unknown callers get a relaxed backstop (x20) instead of a bucket shared by every visitor. */
export const ipLimit = (ip: string, limit: number) => (ip === DIRECT_IP ? limit * 20 : limit);

/** Atomic shared counter. Returns true when the caller is over the limit. */
export async function limitedShared(key: string, limit: number, windowSeconds: number) {
  const now = new Date();
  const hit = await RateLimit.findOneAndUpdate({ key, resetAt: { $gt: now } }, { $inc: { count: 1 } }, { new: true }).lean<{ count: number }>();
  if (hit) return hit.count > limit;
  try {
    // Only an expired (or absent) window may be restarted: a concurrent caller that already restarted it makes this filter miss, the upsert then
    // collides on the unique key (11000) and that caller is counted in the live window instead of silently resetting it.
    await RateLimit.findOneAndUpdate({ key, resetAt: { $lte: now } }, { $set: { count: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) } }, { upsert: true, new: true });
  } catch (error) {
    if ((error as { code?: number }).code !== 11000) throw error;
    const again = await RateLimit.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true }).lean<{ count: number }>();
    return (again?.count ?? 0) > limit;
  }
  return false;
}
export async function clearLimit(key: string) { await RateLimit.deleteOne({ key }); }
export async function isLocked(key: string, limit: number) {
  const row = await RateLimit.findOne({ key, resetAt: { $gt: new Date() } }).lean<{ count: number }>();
  return !!row && row.count >= limit;
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

/** Login throttles: per account (stops targeted guessing) and per source (stops spraying). Only failures count. */
export const LOGIN_LIMITS = { perAccount: 8, perIp: 40, windowSeconds: 15 * 60 };
export const accountKey = (email: string) => `login:acct:${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32)}`;
export const ipKey = (ip: string) => `login:ip:${ip}`;

export function warnAuth(event: string, details: Record<string, unknown>) {
  log("warn", `auth.${event}`, details);
}
