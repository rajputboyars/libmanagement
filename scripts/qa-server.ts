import { MongoMemoryReplSet } from "mongodb-memory-server";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
// Local-only demo credentials for the disposable QA database (never used outside this script).
const PASSWORD = "LocalTest#2026";
import { SignJWT } from "jose";

async function main() {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 }, binary: { version: "7.0.14" } });
  const base = "http://127.0.0.1:3170";
  const secret = randomBytes(32).toString("hex");
  spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", "3170", "--hostname", "127.0.0.1"], { env: { ...process.env, MONGODB_URI: replica.getUri(), SESSION_SECRET: secret, APP_URL: base, ALLOW_BILLING_SANDBOX: "1" }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 500)); }
  await mongoose.connect(replica.getUri());
  const { User, SyllabusNode, StudentExam, Library } = await import("../src/lib/models");
  const reg = async (email: string, role: string, library?: string) => { const r = await fetch(base + "/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ name: "Demo Person", email, password: PASSWORD, role, library }) }); return r.headers.get("set-cookie")!.split(";")[0].split("=")[1]; };
  const owner = await reg("owner@qa.in", "owner", "QA Library");
  const student = await reg("student@qa.in", "student");
  const post = (cookie: string, path: string, action: string, data: unknown) => fetch(base + path, { method: "POST", headers: { cookie: `sq-session=${cookie}`, Origin: base, "Content-Type": "application/json" }, body: JSON.stringify({ action, data }) });
  await post(owner, "/api/workspace", "students", { email: "student@qa.in", name: "Demo Person" });
  const invite = (await (await fetch(base + "/api/join", { headers: { cookie: `sq-session=${student}` } })).json()).requests.find((r: { status: string }) => r.status === "pending");
  await post(student, "/api/join", "invite-accept", { id: invite._id });
  await post(owner, "/api/onboarding", "seats", { prefix: "A", count: 40 });
  await post(owner, "/api/onboarding", "shifts", { items: [{ name: "Morning", start: 360, end: 720 }] });
  await post(owner, "/api/onboarding", "fees", { items: [{ name: "Monthly", rupees: 1200, days: 30 }] });
  await Library.updateOne({ name: "QA Library" }, { publicSlug: "qa-library", listingVisible: true, city: "Pune" });
  const sub = await User.findOne({ email: "student@qa.in" });
  const subject = await SyllabusNode.create({ examKey: "ssc", type: "subject", title: "Quant", order: 1 });
  const chapter = await SyllabusNode.create({ examKey: "ssc", type: "chapter", title: "Arithmetic", parentId: subject._id, order: 1 });
  await SyllabusNode.create({ examKey: "ssc", type: "topic", title: "Percentages", parentId: chapter._id, order: 1 });
  await StudentExam.create({ userId: sub!._id, examKey: "ssc", examDate: new Date(Date.now() + 80 * 86400000) });
  const admin = await User.create({ name: "Admin", email: "admin@qa.in", passwordHash: await bcrypt.hash(PASSWORD, 10), role: "super-admin" });
  const token = await new SignJWT({ sv: 0 }).setProtectedHeader({ alg: "HS256" }).setSubject(String(admin._id)).setIssuedAt().setExpirationTime("3h").sign(new TextEncoder().encode(secret));
  console.log(`Local QA server: ${base}
  owner   owner@qa.in   / ${PASSWORD}
  student student@qa.in / ${PASSWORD}
  admin   admin@qa.in   / ${PASSWORD}`);
  console.log("READY", JSON.stringify({ owner, student, admin: token }));
  await new Promise(() => {});
}
main().catch((e) => { console.error(e); process.exit(1); });
