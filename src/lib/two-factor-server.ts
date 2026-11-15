import { reportUnexpected } from "./api-errors";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "./db";
import { User } from "./models";
import { currentUser, issueSession, readChallenge, setSessionCookie } from "./auth";
import { requiresTwoFactor } from "./two-factor-policy";
import { log } from "./log";
import { clearLimit, clientIp, ipLimit, isLocked, limitedShared, warnAuth } from "./security";
import { RECOVERY_COUNT, decryptSecret, encryptSecret, findRecoveryMatch, generateSecret, hashRecovery, matchTotp, newRecoveryCode, otpauthUri } from "./two-factor";

const WINDOW = 900; // 15 minutes
const FAIL_LIMIT = 5;
const NOT_CORRECT = "That code is not correct.";
const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const factor = z.object({ code: z.string().trim().max(20).optional(), recoveryCode: z.string().trim().max(30).optional() });

type Result = { ok: true; method: "totp" | "recovery"; recoveryRemaining?: number } | { ok: false; status: number; error: string };

/**
 * Verifies the second factor for one user. Failures are throttled per account (5 per 15 minutes) and per source,
 * a TOTP step can be used once (replay protection) and a recovery code is consumed atomically.
 * `allowRecovery:false` is for actions that must prove possession of the authenticator itself.
 */
export async function verifySecondFactor(userId: string, input: { code?: string; recoveryCode?: string }, ip: string, allowRecovery = true): Promise<Result> {
  const acct = `2fa:acct:${userId}`, ipk = `2fa:ip:${ip}`;
  if ((await isLocked(acct, FAIL_LIMIT)) || (await isLocked(ipk, ipLimit(ip, 40)))) {
    warnAuth("2fa_locked", { ip, userId });
    return { ok: false, status: 429, error: "Too many incorrect codes. Try again in 15 minutes." };
  }
  const user = await User.findById(userId).select("+twoFactorSecretEnc +twoFactorRecovery").lean<{ twoFactorEnabled?: boolean; twoFactorSecretEnc?: string; twoFactorRecovery?: string[] }>();
  let ok = false, method: "totp" | "recovery" = "totp", remaining: number | undefined;
  if (user?.twoFactorEnabled && user.twoFactorSecretEnc) {
    if (input.code) {
      const step = matchTotp(decryptSecret(user.twoFactorSecretEnc), input.code);
      // The same time step is never accepted twice: a code seen once (shoulder-surfing, phishing relay) cannot be replayed.
      if (step !== null && (await User.findOneAndUpdate({ _id: userId, $or: [{ twoFactorLastStep: { $exists: false } }, { twoFactorLastStep: { $lt: step } }] }, { $set: { twoFactorLastStep: step } }, { projection: { _id: 1 } }))) ok = true;
    } else if (input.recoveryCode && allowRecovery) {
      const match = await findRecoveryMatch(input.recoveryCode, user.twoFactorRecovery ?? []);
      // Consumption is one atomic pull: two concurrent uses of the same code cannot both succeed.
      if (match && (await User.findOneAndUpdate({ _id: userId, twoFactorRecovery: match }, { $pull: { twoFactorRecovery: match } }, { projection: { _id: 1 } }))) {
        ok = true;
        method = "recovery";
        remaining = (user.twoFactorRecovery?.length ?? 1) - 1;
      }
    }
  }
  if (!ok) {
    await limitedShared(acct, FAIL_LIMIT, WINDOW);
    await limitedShared(ipk, ipLimit(ip, 40), WINDOW);
    warnAuth("2fa_failed", { ip, userId });
    return { ok: false, status: 401, error: NOT_CORRECT };
  }
  await clearLimit(acct);
  if (method === "recovery") log("warn", "auth.2fa_recovery_used", { userId, remaining });
  return { ok: true, method, recoveryRemaining: remaining };
}

async function passwordOk(userId: string, password: string) {
  if (await limitedShared(`2fa:pw:${userId}`, FAIL_LIMIT, WINDOW)) return false; // counts every attempt; cleared below on success
  const full = await User.findById(userId).select("+passwordHash");
  const ok = !!full && (await bcrypt.compare(password, full.passwordHash));
  if (ok) await clearLimit(`2fa:pw:${userId}`);
  return ok;
}
const newCodes = async () => {
  const plain = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  return { plain, hashes: await Promise.all(plain.map(hashRecovery)) };
};
async function fresh(userId: string, extra: Record<string, unknown>) {
  const user = await User.findByIdAndUpdate(userId, { ...extra, $inc: { sessionVersion: 1 } }, { new: true });
  return user;
}

export async function twoFactorStatus() {
  const user = await currentUser();
  if (!user) return json({ error: "Sign in required" }, 401);
  const row = await User.findById(user._id).select("twoFactorEnabled twoFactorEnabledAt +twoFactorRecovery").lean<{ twoFactorEnabled?: boolean; twoFactorEnabledAt?: Date; twoFactorRecovery?: string[] }>();
  return json({ enabled: !!row?.twoFactorEnabled, enabledAt: row?.twoFactorEnabledAt ?? null, recoveryRemaining: row?.twoFactorRecovery?.length ?? 0 });
}

/** POST /api/auth/2fa-login | 2fa-setup | 2fa-enable | 2fa-disable | 2fa-recovery */
export async function handleTwoFactor(action: string, req: Request): Promise<NextResponse | null> {
  if (!["2fa-login", "2fa-setup", "2fa-enable", "2fa-disable", "2fa-recovery"].includes(action)) return null;
  await db();
  const ip = clientIp(req);
  try {
    const body: unknown = await req.json();
    if (action === "2fa-login") {
      const v = factor.extend({ challenge: z.string().min(20).max(2000) }).parse(body);
      const ch = await readChallenge(v.challenge);
      if (!ch) return json({ error: "Your sign-in expired. Enter your password again.", code: "challenge-expired" }, 401);
      const user = await User.findById(ch.userId).lean<{ _id: unknown; role: string; sessionVersion?: number; deletedAt?: Date; suspendedAt?: Date; twoFactorEnabled?: boolean }>();
      // A password reset or change since the challenge was issued revokes it.
      if (!user || user.deletedAt || user.suspendedAt || !user.twoFactorEnabled || (user.sessionVersion ?? 0) !== ch.sv) return json({ error: "Your sign-in expired. Enter your password again.", code: "challenge-expired" }, 401);
      const r = await verifySecondFactor(String(user._id), v, ip);
      if (!r.ok) return json({ error: r.error }, r.status);
      const response = json({ role: user.role, ...(r.method === "recovery" ? { recoveryUsed: true, recoveryRemaining: r.recoveryRemaining } : {}) });
      setSessionCookie(response, await issueSession(String(user._id), user.sessionVersion ?? 0));
      return response;
    }

    // Enrolment may be done by a normal session, or (privileged accounts only) with the restricted enrolment token from the password step.
    let me: { _id: unknown; email: string; role: string } | null = null;
    let enrolling = false;
    const token = typeof (body as { enrollmentToken?: unknown }).enrollmentToken === "string" ? (body as { enrollmentToken: string }).enrollmentToken : "";
    if (token && (action === "2fa-setup" || action === "2fa-enable")) {
      const ch = await readChallenge(token, "2fa-enroll");
      const u = ch ? await User.findById(ch.userId).lean<{ _id: unknown; email: string; role: string; sessionVersion?: number; deletedAt?: Date; suspendedAt?: Date; twoFactorEnabled?: boolean }>() : null;
      if (!ch || !u || u.deletedAt || u.suspendedAt || u.twoFactorEnabled || !requiresTwoFactor(u.role) || (u.sessionVersion ?? 0) !== ch.sv) return json({ error: "Your sign-in expired. Enter your password again.", code: "challenge-expired" }, 401);
      me = u;
      enrolling = true;
    } else me = await currentUser();
    if (!me) return json({ error: "Sign in required" }, 401);
    const id = String(me._id);

    if (action === "2fa-setup") {
      const v = z.object({ password: z.string().min(1).max(100) }).passthrough().parse(body);
      const state = await User.findById(id).select("twoFactorEnabled").lean<{ twoFactorEnabled?: boolean }>();
      if (state?.twoFactorEnabled) return json({ error: "Two-step sign-in is already on." }, 400);
      if (!(await passwordOk(id, v.password))) return json({ error: "Your password is not correct." }, 400);
      const secret = generateSecret();
      await User.updateOne({ _id: id }, { $set: { twoFactorPendingEnc: encryptSecret(secret) } });
      const uri = otpauthUri(secret, me.email);
      return json({ secret, otpauthUri: uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
    }

    if (action === "2fa-enable") {
      const v = z.object({ code: z.string().trim().min(6).max(10) }).passthrough().parse(body);
      if (await limitedShared(`2fa:enable:${id}`, FAIL_LIMIT, WINDOW)) return json({ error: "Too many attempts. Try again in 15 minutes." }, 429);
      const row = await User.findById(id).select("twoFactorEnabled +twoFactorPendingEnc").lean<{ twoFactorEnabled?: boolean; twoFactorPendingEnc?: string }>();
      if (!row || row.twoFactorEnabled || !row.twoFactorPendingEnc) return json({ error: "Start again: set up two-step sign-in first." }, 400);
      const pending = decryptSecret(row.twoFactorPendingEnc);
      const step = matchTotp(pending, v.code);
      if (step === null) { warnAuth("2fa_enable_failed", { ip, userId: id }); return json({ error: NOT_CORRECT }, 400); }
      const { plain, hashes } = await newCodes();
      // Atomic: only the first confirmation wins, and the pending seed becomes the live one.
      const claimed = await User.findOneAndUpdate({ _id: id, twoFactorEnabled: { $ne: true }, twoFactorPendingEnc: row.twoFactorPendingEnc }, { $set: { twoFactorEnabled: true, twoFactorEnabledAt: new Date(), twoFactorSecretEnc: row.twoFactorPendingEnc, twoFactorLastStep: step, twoFactorRecovery: hashes }, $unset: { twoFactorPendingEnc: 1 }, $inc: { sessionVersion: 1 } }, { new: true });
      if (!claimed) return json({ error: "Start again: set up two-step sign-in first." }, 400);
      await clearLimit(`2fa:enable:${id}`);
      log("info", "auth.2fa_enabled", { userId: id });
      // The new session is only issued now, after the second factor was proven; enrolment tokens never become sessions themselves.
      const response = json({ ok: true, recoveryCodes: plain, role: me.role, enrolled: enrolling });
      setSessionCookie(response, await issueSession(id, claimed.sessionVersion ?? 0)); // other devices are signed out
      return response;
    }

    if (action === "2fa-disable") {
      // Owners and platform admins cannot turn it off: that would silently remove their own access (and the policy). Operators use reset-2fa.
      if (requiresTwoFactor(me.role)) return json({ error: "Two-step sign-in is required for your account and cannot be turned off." }, 403);
      const v = factor.extend({ password: z.string().min(1).max(100) }).parse(body);
      if (!(await passwordOk(id, v.password))) return json({ error: "Your password is not correct." }, 400);
      const state = await User.findById(id).select("twoFactorEnabled").lean<{ twoFactorEnabled?: boolean }>();
      if (!state?.twoFactorEnabled) return json({ error: "Two-step sign-in is not on." }, 400);
      const r = await verifySecondFactor(id, v, ip);
      if (!r.ok) return json({ error: r.error }, r.status);
      const user = await fresh(id, { $set: { twoFactorEnabled: false }, $unset: { twoFactorSecretEnc: 1, twoFactorPendingEnc: 1, twoFactorLastStep: 1, twoFactorRecovery: 1, twoFactorEnabledAt: 1 } });
      log("warn", "auth.2fa_disabled", { userId: id });
      const response = json({ ok: true });
      setSessionCookie(response, await issueSession(id, user?.sessionVersion ?? 0));
      return response;
    }

    // 2fa-recovery: new recovery codes (the old ones stop working). Needs the password and a code from the authenticator app.
    const v = z.object({ password: z.string().min(1).max(100), code: z.string().trim().min(6).max(10) }).parse(body);
    if (!(await passwordOk(id, v.password))) return json({ error: "Your password is not correct." }, 400);
    const r = await verifySecondFactor(id, { code: v.code }, ip, false);
    if (!r.ok) return json({ error: r.error }, r.status);
    const { plain, hashes } = await newCodes();
    await User.updateOne({ _id: id, twoFactorEnabled: true }, { $set: { twoFactorRecovery: hashes } });
    log("info", "auth.2fa_recovery_regenerated", { userId: id });
    return json({ ok: true, recoveryCodes: plain });
  } catch (error) {
    reportUnexpected(error, "/api/auth/2fa");
    return json({ error: error instanceof z.ZodError ? "Check your entries." : "Unable to complete the request." }, 400);
  }
}
