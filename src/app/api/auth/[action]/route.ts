import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { db } from "@/lib/db";
import { User, Library, StudentProfile } from "@/lib/models";
import { createOrganization, ensurePlans, linkPendingStudent } from "@/lib/saas-server";
import { attachReferral } from "@/lib/referrals";
import { handleAuthExtra } from "@/lib/auth-extra";
import { LOGIN_LIMITS, accountKey, clearLimit, clientIp, ipKey, isLocked, limitedShared, warnAuth } from "@/lib/security";
import {
  currentUser,
  issueSession,
  secret,
  validOrigin,
} from "@/lib/auth";
let dummyHash: Promise<string> | undefined;
const DUMMY_HASH = () => (dummyHash ??= bcrypt.hash("not-a-real-password", 12));
const input = z.object({
  email: z.email().max(200),
  password: z.string().min(10).max(100),
  name: z.string().min(2).max(80).optional(),
  role: z.enum(["student", "owner"]).optional(),
  library: z.string().min(2).max(100).optional(),
  referralCode: z.string().trim().max(20).optional(),
});
export async function GET() {
  const user = await currentUser();
  return NextResponse.json({ user });
}
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ action: string }> },
) {
  if (!validOrigin(req))
    return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const { action } = await ctx.params;
  if (action === "logout") {
    const response = NextResponse.json({ ok: true });
    response.cookies.delete("sq-session");
    return response;
  }
  const extra = await handleAuthExtra(action, req.clone());
  if (extra) return extra;
  const ip = clientIp(req);
  if (action === "register") {
    await db().catch(() => null);
    if (await limitedShared(`register:ip:${ip}`, 20, 3600).catch(() => false))
      return NextResponse.json({ error: "Too many sign-ups from this network. Try again later." }, { status: 429 });
  }
  try {
    const data = input.parse(await req.json());
    secret();
    await db();
    let user;
    if (action === "register") {
      if (!data.name) throw new Error("Name is required");
      const passwordHash = await bcrypt.hash(data.password, 12);
      await ensurePlans();
      let newOrgId: unknown;
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          [user] = await User.create(
            [
              {
                name: data.name,
                email: data.email.toLowerCase(),
                passwordHash,
                role: data.role || "student",
              },
            ],
            { session },
          );
          if (data.role === "owner") {
            const [library] = await Library.create(
              [
                {
                  name: data.library || `${data.name}'s library`,
                  ownerId: user._id,
                },
              ],
              { session },
            );
            user.libraryId = library._id;
            await user.save({ session });
            const org = await createOrganization({ ownerId: user._id, name: data.library || `${data.name}'s library`, libraryIds: [library._id], trialPlanKey: "pro", referralCode: data.referralCode, billingEmail: data.email }, { session });
            newOrgId = org._id;
          } else
            await StudentProfile.create([{ userId: user._id }], { session });
        });
      } finally {
        await session.endSession();
      }
      if (data.role !== "owner" && user) await linkPendingStudent((user as { _id: string })._id, data.email).catch(() => null);
      if (newOrgId && data.referralCode) await attachReferral(newOrgId as string, data.referralCode).catch(() => null);
    } else if (action === "login") {
      const acct = accountKey(data.email), ipk = ipKey(ip);
      if ((await isLocked(acct, LOGIN_LIMITS.perAccount)) || (await isLocked(ipk, LOGIN_LIMITS.perIp))) {
        warnAuth("login_locked", { ip });
        return NextResponse.json({ error: "Too many failed attempts. Try again in 15 minutes or reset your password." }, { status: 429 });
      }
      user = await User.findOne({ email: data.email.toLowerCase(), deletedAt: { $exists: false } }).select("+passwordHash");
      // Always run bcrypt so response time does not reveal whether the account exists.
      const ok = await bcrypt.compare(data.password, user?.passwordHash ?? (await DUMMY_HASH()));
      if (!user || !ok || user.invited) {
        await limitedShared(acct, LOGIN_LIMITS.perAccount, LOGIN_LIMITS.windowSeconds);
        await limitedShared(ipk, LOGIN_LIMITS.perIp, LOGIN_LIMITS.windowSeconds);
        warnAuth("login_failed", { ip });
        return NextResponse.json({ error: "Email or password is incorrect" }, { status: 401 });
      }
      await clearLimit(acct);
    } else return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!user) throw new Error("Unable to create account");
    const response = NextResponse.json({ role: user.role });
    response.cookies.set("sq-session", await issueSession(String(user._id), user.sessionVersion ?? 0), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 604800,
    });
    return response;
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "Please check your entries. Passwords need at least 10 characters."
        : !process.env.MONGODB_URI
          ? "Connect MongoDB to enable accounts. See README."
          : "Unable to sign in or register. Check your details and database connection.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
