// Operator-only account recovery for a person who lost BOTH their authenticator and their recovery codes.
//   RESET_2FA_EMAIL=person@example.in npm run reset-2fa
// Verify the person's identity out of band first (this script cannot). It switches two-step sign-in off, deletes the stored
// seed and recovery codes, and signs the account out everywhere. The person signs in with their password and enrols again.
// Owners and platform admins get NO access in the meantime: without two-step sign-in their sessions are refused, so this reset
// never grants privileged access; they must complete enrolment (QR + code + recovery codes) before a session is issued.
import { db } from "../src/lib/db";
import { User } from "../src/lib/models";
import mongoose from "mongoose";
async function main() {
  const email = (process.env.RESET_2FA_EMAIL ?? "").trim().toLowerCase();
  if (!email) throw new Error("Set RESET_2FA_EMAIL to the account's email address.");
  await db();
  const user = await User.findOneAndUpdate(
    { email, deletedAt: { $exists: false } },
    { $set: { twoFactorEnabled: false }, $unset: { twoFactorSecretEnc: 1, twoFactorPendingEnc: 1, twoFactorLastStep: 1, twoFactorRecovery: 1, twoFactorEnabledAt: 1 }, $inc: { sessionVersion: 1 } },
    { new: true },
  );
  if (!user) throw new Error("No active account with that email.");
  console.log(`Two-step sign-in reset for ${email}. All sessions for the account were ended. Owners and platform admins must enrol again at their next sign-in before they get any access. Record who approved this and why.`);
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
