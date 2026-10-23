import { timingSafeEqual } from "node:crypto";

/** True when the scheduler sent the CRON_SECRET, either as Vercel Cron's "Authorization: Bearer <secret>" or the "x-cron-secret" header. */
export function cronAuthorized(headers: Headers, secret = process.env.CRON_SECRET) {
  if (!secret) return false;
  const bearer = headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const given = bearer ?? headers.get("x-cron-secret") ?? "";
  const a = Buffer.from(secret), b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
