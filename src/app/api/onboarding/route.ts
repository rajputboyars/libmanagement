import { createHash, randomInt } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Library, MembershipPlan, Seat, Shift, User } from "@/lib/models";
import { OnboardingDraft, Organization, PendingStudent, VerificationCode } from "@/lib/saas-models";
import { PlanError, accessForLibrary, activeStudentCount, audit, requireStudentRoom, verifyOrgOwner } from "@/lib/saas-server";
import { parseStudentCsv } from "@/lib/saas";
import { sendEmail, sendSms } from "@/lib/saas-notify";

const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
const STEPS = ["organization", "verify", "branch", "shifts", "seats", "fees", "students", "plan"] as const;
const hashCode = (userId: string, channel: string, code: string) => createHash("sha256").update(`${userId}:${channel}:${code}:${process.env.SESSION_SECRET ?? ""}`).digest("hex");
const minutes = z.number().int().min(0).max(1440);

async function load() {
  const user = await currentUser();
  if (!user) return { error: err("Sign in required", 401) };
  if (user.role !== "owner" || !user.libraryId) return { error: err("Owner access required", 403) };
  const orgId = await verifyOrgOwner(user);
  const draft = await OnboardingDraft.findOneAndUpdate({ userId: user._id }, { $setOnInsert: { userId: user._id, organizationId: orgId, libraryId: user.libraryId } }, { upsert: true, new: true });
  return { user, orgId, draft };
}
const mark = (draft: InstanceType<typeof OnboardingDraft>, step: string, next?: string) => { if (!draft.completed.includes(step)) draft.completed.push(step); if (next) draft.lastStep = next; };

export async function GET() {
  const l = await load();
  if ("error" in l) return l.error;
  const { user, orgId, draft } = l;
  const libraryId = user.libraryId!;
  const [org, library, shifts, seats, fees, pending, verified, access] = await Promise.all([
    Organization.findById(orgId).select("name onboardingStatus").lean<{ name: string; onboardingStatus: string }>(),
    Library.findById(libraryId).select("name branchName address city").lean(),
    Shift.countDocuments({ libraryId }), Seat.countDocuments({ libraryId }), MembershipPlan.countDocuments({ libraryId }),
    PendingStudent.countDocuments({ libraryId }), VerificationCode.find({ userId: user._id, verifiedAt: { $exists: true } }).distinct("channel"), accessForLibrary(libraryId),
  ]);
  return NextResponse.json({ steps: STEPS, completed: draft.completed, lastStep: draft.lastStep, status: draft.status, organization: org, library, counts: { shifts, seats, fees, pendingStudents: pending, students: await activeStudentCount(orgId) }, verified, email: user.email, plan: access?.entitlements.planName, studentLimit: access?.entitlements.limits.activeStudents });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const l = await load();
  if ("error" in l) return l.error;
  const { user, orgId, draft } = l;
  const libraryId = user.libraryId!;
  if (limited(`onboarding:${user._id}`, 40)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    let record: unknown = {};
    switch (body.action) {
      case "organization": {
        const v = z.object({ name: z.string().trim().min(2).max(100) }).parse(body.data);
        await Organization.updateOne({ _id: orgId }, { name: v.name });
        mark(draft, "organization", "verify"); break;
      }
      case "verify-send": {
        const v = z.object({ channel: z.enum(["email", "mobile"]), target: z.string().trim().min(5).max(120).optional() }).parse(body.data);
        const target = v.channel === "email" ? (v.target || user.email).toLowerCase() : (v.target || "").replace(/[^\d+]/g, "");
        if (v.channel === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new Error("Enter a valid email");
        if (v.channel === "mobile" && target.replace(/\D/g, "").length < 10) throw new Error("Enter a valid mobile number");
        if (await VerificationCode.countDocuments({ userId: user._id, channel: v.channel, createdAt: { $gt: new Date(Date.now() - 3600000) } }) >= 3) throw new Error("Too many codes requested. Try again in an hour.");
        const code = String(randomInt(100000, 1000000));
        await VerificationCode.create({ userId: user._id, channel: v.channel, target, codeHash: hashCode(String(user._id), v.channel, code), expiresAt: new Date(Date.now() + 10 * 60000) });
        const result = v.channel === "email" ? await sendEmail(target, "Your StudyQuest verification code", `Your code is ${code}. It expires in 10 minutes.`) : await sendSms(target, `Your StudyQuest code is ${code}`);
        const sandbox = result === "not-configured" && process.env.NODE_ENV !== "production";
        record = { delivered: result === "accepted", provider: result, ...(sandbox ? { sandboxCode: code, notice: "Local sandbox: no delivery provider is configured, so the code is shown here." } : {}), ...(result === "not-configured" && !sandbox ? { notice: "No delivery provider is configured. You can skip verification for now." } : {}) };
        if (result === "failed") throw new Error("The delivery provider could not send the code. Try again.");
        break;
      }
      case "verify-check": {
        const v = z.object({ channel: z.enum(["email", "mobile"]), code: z.string().regex(/^\d{6}$/) }).parse(body.data);
        const latest = await VerificationCode.findOne({ userId: user._id, channel: v.channel, verifiedAt: { $exists: false } }).sort({ createdAt: -1 });
        if (!latest || latest.expiresAt < new Date()) throw new Error("Code expired. Request a new one.");
        if (latest.attempts >= 5) throw new Error("Too many attempts. Request a new code.");
        latest.attempts += 1;
        if (latest.codeHash !== hashCode(String(user._id), v.channel, v.code)) { await latest.save(); throw new Error("That code is not correct"); }
        latest.verifiedAt = new Date(); await latest.save();
        mark(draft, "verify", "branch"); break;
      }
      case "skip": {
        const v = z.object({ step: z.enum(STEPS) }).parse(body.data);
        mark(draft, v.step, STEPS[Math.min(STEPS.indexOf(v.step) + 1, STEPS.length - 1)]); break;
      }
      case "branch": {
        const v = z.object({ branchName: z.string().trim().min(2).max(80), city: z.string().trim().min(2).max(80), address: z.string().trim().max(200).default("") }).parse(body.data);
        await Library.updateOne({ _id: libraryId }, { branchName: v.branchName, city: v.city, address: v.address });
        mark(draft, "branch", "shifts"); break;
      }
      case "shifts": {
        const v = z.object({ items: z.array(z.object({ name: z.string().trim().min(2).max(40), start: minutes, end: minutes })).min(1).max(8) }).parse(body.data);
        if (v.items.some((s) => s.end <= s.start)) throw new Error("Each shift must end after it starts");
        for (const s of v.items) await Shift.updateOne({ libraryId, name: s.name }, { $set: { start: s.start, end: s.end } }, { upsert: true });
        mark(draft, "shifts", "seats"); break;
      }
      case "seats": {
        const v = z.object({ floor: z.string().trim().min(1).max(40).default("Ground floor"), prefix: z.string().trim().min(1).max(4), count: z.number().int().min(1).max(300) }).parse(body.data);
        if ((await Seat.countDocuments({ libraryId })) + v.count > 1000) throw new Error("A branch can have at most 1000 seats");
        const ops = Array.from({ length: v.count }, (_, i) => ({ updateOne: { filter: { libraryId, label: `${v.prefix}${i + 1}` }, update: { $setOnInsert: { floor: v.floor, operationalStatus: "available" } }, upsert: true } }));
        const result = await Seat.bulkWrite(ops);
        record = { created: result.upsertedCount, existing: v.count - result.upsertedCount };
        mark(draft, "seats", "fees"); break;
      }
      case "fees": {
        const v = z.object({ items: z.array(z.object({ name: z.string().trim().min(2).max(60), rupees: z.number().min(0).max(1000000), days: z.number().int().min(1).max(366) })).min(1).max(10) }).parse(body.data);
        for (const f of v.items) await MembershipPlan.updateOne({ libraryId, name: f.name }, { $set: { amount: Math.round(f.rupees * 100), days: f.days } }, { upsert: true });
        mark(draft, "fees", "students"); break;
      }
      case "students-preview":
      case "students-import": {
        const v = z.object({ csv: z.string().max(200000) }).parse(body.data);
        const parsed = parseStudentCsv(v.csv);
        const existing = new Set((await User.find({ email: { $in: parsed.rows.map((r) => r.email) } }).select("email").lean<{ email: string }[]>()).map((u) => u.email));
        const pendingSet = new Set((await PendingStudent.find({ libraryId, email: { $in: parsed.rows.map((r) => r.email) } }).select("email").lean<{ email: string }[]>()).map((u) => u.email));
        const fresh = parsed.rows.filter((r) => !pendingSet.has(r.email));
        const linkable = fresh.filter((r) => existing.has(r.email));
        if (body.action === "students-preview") { record = { rows: parsed.rows.length, newRows: fresh.length, alreadyPending: parsed.rows.length - fresh.length, matchesRegistered: linkable.length, errors: parsed.errors.slice(0, 50) }; break; }
        if (!fresh.length) throw new Error("Nothing new to import");
        await requireStudentRoom(libraryId, fresh.length);
        const result = await PendingStudent.bulkWrite(fresh.map((r) => ({ updateOne: { filter: { libraryId, email: r.email }, update: { $setOnInsert: { organizationId: orgId, name: r.name, phone: r.phone } }, upsert: true } })));
        // Students who already registered (and have no library) are linked now; the rest link when they register.
        const free = await User.find({ email: { $in: fresh.map((r) => r.email) }, role: "student", libraryId: { $exists: false } }).select("_id email").lean<{ _id: unknown; email: string }[]>();
        for (const u of free) { await User.updateOne({ _id: u._id }, { libraryId }); await PendingStudent.updateOne({ libraryId, email: u.email }, { status: "linked" }); }
        record = { imported: result.upsertedCount, linkedNow: free.length, errors: parsed.errors.slice(0, 50) };
        await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "students.import", details: { rows: fresh.length } });
        mark(draft, "students", "plan"); break;
      }
      case "plan": {
        const v = z.object({ planKey: z.string().min(2).max(30) }).parse(body.data);
        draft.data = { ...(draft.data as object), chosenPlan: v.planKey }; draft.markModified("data");
        mark(draft, "plan"); break;
      }
      case "complete": {
        const required = ["organization", "branch"];
        const missing = required.filter((s) => !draft.completed.includes(s));
        if (missing.length) throw new Error(`Finish these steps first: ${missing.join(", ")}`);
        await Organization.updateOne({ _id: orgId }, { onboardingStatus: "complete" });
        draft.status = "complete"; break;
      }
      default: throw new Error("Unsupported action");
    }
    await draft.save();
    return NextResponse.json({ ok: true, record, completed: draft.completed, lastStep: draft.lastStep, status: draft.status });
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, 402, error.code);
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to save", error instanceof z.ZodError ? 422 : 400);
  }
}
