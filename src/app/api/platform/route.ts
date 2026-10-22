import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Library, Membership, User } from "@/lib/models";
import { Organization, PlatformSettings, SaaSSubscription } from "@/lib/saas-models";
import { FEATURES, type Overrides } from "@/lib/saas";
import { accessForLibrary, audit, ensurePlans } from "@/lib/saas-server";
import { applyFeatureSwitch, featureCell } from "@/lib/feature-matrix";
import { STUDENT_FEATURES, isStudentFeature, paidUpStatus } from "@/lib/student-access";
import { premiumStudentFeatures } from "@/lib/student-access-server";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Lean = Record<string, unknown> & { _id: unknown };
type MembershipRow = { userId: unknown; libraryId: unknown; start: Date; end: Date; status?: string; amount?: number; discount?: number; paid?: number };

async function admin() {
  const user = await currentUser();
  return user && user.role === "super-admin" ? user : null;
}

/** Paid-up status for many students at once. */
async function paidUpByUser(userIds: unknown[], now = new Date()) {
  const rows = await Membership.find({ userId: { $in: userIds }, end: { $gt: now } })
    .select("userId libraryId start end status amount discount paid")
    .lean<MembershipRow[]>();
  const byUser = new Map<string, MembershipRow[]>();
  for (const r of rows) byUser.set(String(r.userId), [...(byUser.get(String(r.userId)) ?? []), r]);
  return (id: unknown) => paidUpStatus(byUser.get(String(id)) ?? [], now);
}

export async function GET(request: NextRequest) {
  const user = await admin();
  if (!user) return err("Platform administrator access required", 403);
  await ensurePlans();
  const p = request.nextUrl.searchParams;
  const view = p.get("view") || "features";
  const page = Math.max(1, Number(p.get("page") || 1));
  const q = (p.get("q") || "").trim().slice(0, 60);

  if (view === "features") {
    const filter = q ? { name: new RegExp(escapeRegex(q), "i") } : {};
    const [orgs, total] = await Promise.all([
      Organization.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean<(Lean & { name: string; ownerId: unknown; status?: string })[]>(),
      Organization.countDocuments(filter),
    ]);
    const ids = orgs.map((o) => o._id);
    const [subs, owners, libs] = await Promise.all([
      SaaSSubscription.find({ organizationId: { $in: ids } }).lean<(Lean & { organizationId: unknown; planKey: string; status: string; planSnapshot?: { name?: string; features?: string[] }; overrides?: Overrides; trialEnd?: Date })[]>(),
      User.find({ _id: { $in: orgs.map((o) => o.ownerId) } }).select("name email").lean<(Lean & { name: string; email: string })[]>(),
      Library.find({ organizationId: { $in: ids } }).select("organizationId name").lean<(Lean & { organizationId: unknown; name: string })[]>(),
    ]);
    const items = await Promise.all(
      orgs.map(async (o) => {
        const sub = subs.find((s) => String(s.organizationId) === String(o._id));
        const lib = libs.find((l) => String(l.organizationId) === String(o._id));
        const access = lib ? await accessForLibrary(lib._id as Parameters<typeof accessForLibrary>[0]) : null;
        const effective = access?.entitlements.features ?? [];
        const planFeatures = sub?.planSnapshot?.features ?? [];
        return {
          _id: o._id,
          name: o.name,
          owner: owners.find((u) => String(u._id) === String(o.ownerId)) ?? null,
          branches: libs.filter((l) => String(l.organizationId) === String(o._id)).length,
          plan: sub ? { key: sub.planKey, name: sub.planSnapshot?.name ?? sub.planKey, status: sub.status, trialEnd: sub.trialEnd ?? null } : null,
          restricted: access?.entitlements.restricted ?? true,
          reason: access?.entitlements.reason ?? "No subscription",
          override: sub?.overrides ? { reason: sub.overrides.reason ?? "", expiresAt: sub.overrides.expiresAt ?? null } : null,
          cells: Object.fromEntries(Object.keys(FEATURES).map((f) => [f, featureCell(f, planFeatures, sub?.overrides, effective)])),
        };
      }),
    );
    return NextResponse.json({ features: FEATURES, total, page, items });
  }

  if (view === "students") {
    const premium = await premiumStudentFeatures();
    const now = new Date();
    const libraries = await Library.find({}).sort({ createdAt: -1 }).limit(200).select("name").lean<(Lean & { name: string })[]>();
    const students = await User.find({ role: "student", libraryId: { $in: libraries.map((l) => l._id) }, deletedAt: { $exists: false } }).select("libraryId").lean<(Lean & { libraryId: unknown })[]>();
    const status = await paidUpByUser(students.map((s) => s._id), now);
    const stats = libraries.map((l) => {
      const mine = students.filter((s) => String(s.libraryId) === String(l._id));
      const states = mine.map((s) => status(s._id));
      return {
        _id: l._id,
        name: l.name,
        students: mine.length,
        paidUp: states.filter((x) => x.paidUp).length,
        withDues: states.filter((x) => x.reason === "dues").length,
        noMembership: states.filter((x) => x.reason === "no-membership").length,
      };
    });
    return NextResponse.json({
      catalog: Object.fromEntries(Object.entries(STUDENT_FEATURES).map(([k, v]) => [k, { label: v.label, paths: v.paths }])),
      premium,
      libraries: stats.filter((s) => s.students > 0),
    });
  }

  if (view === "accounts") {
    const role = p.get("role");
    const filter: Record<string, unknown> = { deletedAt: { $exists: false } };
    if (role && ["student", "owner", "staff", "super-admin"].includes(role)) filter.role = role;
    if (p.get("suspended") === "1") filter.suspendedAt = { $exists: true };
    if (q) filter.$or = [{ name: new RegExp(escapeRegex(q), "i") }, { email: new RegExp(escapeRegex(q), "i") }];
    const [users, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).select("name email role libraryId suspendedAt suspendedReason createdAt").lean<(Lean & { name: string; email: string; role: string; libraryId?: unknown; suspendedAt?: Date; suspendedReason?: string; createdAt?: Date })[]>(),
      User.countDocuments(filter),
    ]);
    const libIds = users.map((u) => u.libraryId).filter(Boolean);
    const libs = await Library.find({ _id: { $in: libIds } }).select("name organizationId").lean<(Lean & { name: string; organizationId?: unknown })[]>();
    const subs = await SaaSSubscription.find({ organizationId: { $in: libs.map((l) => l.organizationId).filter(Boolean) } }).select("organizationId planKey status planSnapshot.name").lean<(Lean & { organizationId: unknown; planKey: string; status: string; planSnapshot?: { name?: string } })[]>();
    const status = await paidUpByUser(users.filter((u) => u.role === "student").map((u) => u._id));
    return NextResponse.json({
      total,
      page,
      items: users.map((u) => {
        const lib = libs.find((l) => String(l._id) === String(u.libraryId));
        const sub = lib ? subs.find((s) => String(s.organizationId) === String(lib.organizationId)) : undefined;
        return {
          _id: u._id,
          name: u.name,
          email: u.email,
          role: u.role,
          createdAt: u.createdAt,
          library: lib?.name ?? null,
          plan: sub ? `${sub.planSnapshot?.name ?? sub.planKey} · ${sub.status}` : null,
          payment: u.role === "student" ? status(u._id) : null,
          suspendedAt: u.suspendedAt ?? null,
          suspendedReason: u.suspendedReason ?? "",
        };
      }),
    });
  }
  return err("Unknown view", 404);
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await admin();
  if (!user) return err("Platform administrator access required", 403);
  if (limited(`platform:${user._id}`, 60)) return err("Please slow down", 429);
  try {
    const body = await request.json();
    const action = z.enum(["feature-set", "student-premium-save", "account-suspend", "account-reinstate"]).parse(body.action);

    if (action === "feature-set") {
      const v = z
        .object({ organizationId: objectId, feature: z.string(), mode: z.enum(["on", "off", "plan"]), reason: z.string().trim().min(3).max(200), days: z.number().int().min(1).max(3650).optional() })
        .parse(body.data);
      if (!(v.feature in FEATURES)) throw new Error("Unknown feature");
      const sub = await SaaSSubscription.findOne({ organizationId: v.organizationId });
      if (!sub) throw new Error("This library has no subscription yet");
      const next = applyFeatureSwitch(sub.overrides as Overrides | undefined, v.feature, v.mode);
      const empty = !next.features?.add?.length && !next.features?.remove?.length && !next.limits?.activeStudents && !next.limits?.branches;
      sub.overrides = empty ? undefined : { ...next, reason: v.reason, expiresAt: v.days ? new Date(Date.now() + v.days * 86400000) : (next.expiresAt ?? undefined) };
      sub.markModified("overrides");
      await sub.save();
      await audit({ organizationId: v.organizationId, actorId: user._id, actorRole: "super-admin", action: "feature.set", targetType: "subscription", targetId: String(sub._id), details: v });
      return NextResponse.json({ ok: true });
    }

    if (action === "student-premium-save") {
      const v = z.object({ features: z.array(z.string()).max(20) }).parse(body.data);
      const features = [...new Set(v.features)].filter(isStudentFeature);
      await PlatformSettings.updateOne({ key: "default" }, { $set: { premiumStudentFeatures: features } }, { upsert: true });
      await audit({ actorId: user._id, actorRole: "super-admin", action: "student-premium.save", details: { features } });
      return NextResponse.json({ ok: true, features });
    }

    const v = z.object({ userId: objectId, reason: z.string().trim().max(200).default("") }).parse(body.data);
    if (String(v.userId) === String(user._id)) throw new Error("You can't suspend your own account");
    const target = await User.findById(v.userId).select("role").lean<{ role: string }>();
    if (!target) throw new Error("Account not found");
    if (target.role === "super-admin") throw new Error("Platform administrator accounts can't be suspended here");
    if (action === "account-suspend") {
      if (v.reason.length < 3) throw new Error("Give a reason (at least 3 characters)");
      // Bumping sessionVersion signs the person out on every device.
      await User.updateOne({ _id: v.userId }, { $set: { suspendedAt: new Date(), suspendedReason: v.reason }, $inc: { sessionVersion: 1 } });
    } else {
      await User.updateOne({ _id: v.userId }, { $unset: { suspendedAt: 1, suspendedReason: 1 } });
    }
    await audit({ actorId: user._id, actorRole: "super-admin", action: action === "account-suspend" ? "account.suspend" : "account.reinstate", targetType: "user", targetId: String(v.userId), details: { reason: v.reason } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err(e.issues[0]?.message ?? "Invalid request");
    return err(e instanceof Error ? e.message : "Could not save");
  }
}
