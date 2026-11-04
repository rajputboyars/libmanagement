import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "./db";
import { User } from "./models";
import { PasswordReset } from "./ops-models";
import { currentUser, issueSession } from "./auth";
import { clientIp, hashToken, limitedShared, newToken, warnAuth } from "./security";
import { emailConfigured, sendEmail } from "./saas-notify";
import { log } from "./log";

const password = z.string().min(10).max(100);
const cookie = (response: NextResponse, token: string) =>
  response.cookies.set("sq-session", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 604800 });

/** Password reset, change and global sign-out. Every successful credential change revokes all existing sessions. */
export async function handleAuthExtra(action: string, req: Request): Promise<NextResponse | null> {
  if (!["forgot", "reset", "change-password", "logout-all"].includes(action)) return null;
  await db();
  const ip = clientIp(req);
  try {
    if (action === "forgot") {
      const { email } = z.object({ email: z.email().max(200) }).parse(await req.json());
      // Missing configuration is the same for every address, so failing here reveals nothing about accounts.
      if (!emailConfigured() && process.env.NODE_ENV === "production") {
        log("error", "auth.reset_email_not_configured");
        return NextResponse.json({ error: "Password reset by email is not available right now. Please contact support.", code: "email-not-configured" }, { status: 503 });
      }
      if (await limitedShared(`forgot:ip:${ip}`, 20, 3600) || await limitedShared(`forgot:acct:${email.toLowerCase()}`, 3, 3600))
        return NextResponse.json({ ok: true, message: "If that account exists, a reset link has been sent." }); // same answer: no enumeration or limit leak
      const user = await User.findOne({ email: email.toLowerCase(), deletedAt: { $exists: false } }).select("_id").lean<{ _id: unknown }>();
      let sandboxToken: string | undefined;
      if (user) {
        const token = newToken();
        const reset = await PasswordReset.create({ userId: user._id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 30 * 60000) });
        const link = `${process.env.APP_URL || new URL(req.url).origin}/reset-password?token=${token}`;
        const result = await sendEmail(email, "Reset your StudyQuest password", `Use this link within 30 minutes to choose a new password: ${link}\nIf you did not ask for this, ignore this email.`);
        if (result === "not-configured") { log("warn", "auth.reset_email_not_configured"); if (process.env.NODE_ENV !== "production") sandboxToken = token; }
        else if (result === "failed") {
          // The answer stays generic (no account enumeration), but the undelivered link is revoked and the failure is logged.
          await PasswordReset.deleteOne({ _id: reset._id });
          log("error", "auth.reset_email_failed");
        }
      }
      return NextResponse.json({ ok: true, message: "If that account exists, a reset link has been sent.", ...(sandboxToken ? { sandboxToken, notice: "Local sandbox: no email provider is configured." } : {}) });
    }
    if (action === "reset") {
      const v = z.object({ token: z.string().min(20).max(100), password }).parse(await req.json());
      if (await limitedShared(`reset:ip:${ip}`, 20, 3600)) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
      const record = await PasswordReset.findOne({ tokenHash: hashToken(v.token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
      if (!record) { warnAuth("reset_invalid_token", { ip }); return NextResponse.json({ error: "This reset link is invalid or has expired." }, { status: 400 }); }
      const claimed = await PasswordReset.findOneAndUpdate({ _id: record._id, usedAt: { $exists: false } }, { usedAt: new Date() });
      if (!claimed) return NextResponse.json({ error: "This reset link was already used." }, { status: 400 });
      const user = await User.findByIdAndUpdate(record.userId, { passwordHash: await bcrypt.hash(v.password, 12), $inc: { sessionVersion: 1 }, invited: false }, { new: true });
      await PasswordReset.updateMany({ userId: record.userId, usedAt: { $exists: false } }, { usedAt: new Date() });
      if (!user) return NextResponse.json({ error: "Account not found" }, { status: 400 });
      log("info", "auth.password_reset", { userId: String(user._id) });
      const response = NextResponse.json({ ok: true, role: user.role });
      cookie(response, await issueSession(String(user._id), user.sessionVersion));
      return response;
    }
    const user = await currentUser();
    if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    if (action === "logout-all") {
      const updated = await User.findByIdAndUpdate(user._id, { $inc: { sessionVersion: 1 } }, { new: true });
      const response = NextResponse.json({ ok: true });
      response.cookies.delete("sq-session");
      log("info", "auth.logout_all", { userId: String(user._id), version: updated?.sessionVersion });
      return response;
    }
    const v = z.object({ current: z.string().min(1).max(100), password }).parse(await req.json());
    if (await limitedShared(`chpw:${user._id}`, 5, 900)) return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 429 });
    const full = await User.findById(user._id).select("+passwordHash");
    if (!full || !(await bcrypt.compare(v.current, full.passwordHash))) return NextResponse.json({ error: "Your current password is not correct" }, { status: 400 });
    full.passwordHash = await bcrypt.hash(v.password, 12);
    full.sessionVersion = (full.sessionVersion ?? 0) + 1; // signs out every other device
    await full.save();
    const response = NextResponse.json({ ok: true });
    cookie(response, await issueSession(String(full._id), full.sessionVersion));
    return response;
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? "Check your entries. Passwords need at least 10 characters." : "Unable to complete the request." }, { status: 400 });
  }
}
