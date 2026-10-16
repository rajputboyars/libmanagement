import { db } from "../src/lib/db";
import { User } from "../src/lib/models";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
async function main() {
  const email = process.env.ADMIN_EMAIL,
    password = process.env.ADMIN_PASSWORD;
  if (!email || !password || password.length < 12)
    throw new Error(
      "Supply ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters) in your local environment.",
    );
  await db();
  if (await User.exists({ email }))
    throw new Error("Account already exists; no role was changed.");
  await User.create({
    name: "Platform administrator",
    email,
    passwordHash: await bcrypt.hash(password, 12),
    role: "super-admin",
  });
  console.log("Administrator account created.");
  await mongoose.disconnect();
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
