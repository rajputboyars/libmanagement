import { createHash, randomBytes } from "node:crypto";
import { RateLimit } from "./ops-models";
import { log } from "./log";

/**
 * Client IP for rate limiting. Forwarded headers are client-controlled unless a trusted proxy sets them,
 * so they are only honoured when TRUST_PROXY=1. Otherwise all callers share one bucket (per-account limits still apply).
 */
export function clientIp(request: Request) {
  if (process.env.TRUST_PROXY === "1") {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((s) => s.trim()).filter(Boolean);
    return (forwarded && forwarded[forwarded.length - 1]) || request.headers.get("x-real-ip") || "unknown";
  }
  return "direct";
}

/** Atomic shared counter. Returns true when the caller is over the limit. */
export async function limitedShared(key: string, limit: number, windowSeconds: number) {
  const now = new Date();
  const hit = await RateLimit.findOneAndUpdate({ key, resetAt: { $gt: now } }, { $inc: { count: 1 } }, { new: true }).lean<{ count: number }>();
  if (hit) return hit.count > limit;
  try {
    await RateLimit.findOneAndUpdate({ key }, { $set: { count: 1, resetAt: new Date(now.getTime() + windowSeconds * 1000) } }, { upsert: true, new: true });
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
