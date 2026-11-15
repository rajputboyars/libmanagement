import { reportUnexpected } from "@/lib/api-errors";
import { NextRequest, NextResponse } from "next/server";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AuditLog, Library, LibraryRole, Membership, StaffMembership, User } from "@/lib/models";
import { accessFor, moduleStates } from "@/lib/access";
import { MODULES, MODULE_KEYS, dependents, isModuleKey } from "@/lib/modules";
import { PERMISSIONS, PERMISSION_KEYS, PRESET_ROLES, isPermission } from "@/lib/permissions";
import { PlanError, assertWritable } from "@/lib/saas-server";

const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
type Lean = Record<string, unknown> & { _id: unknown };
const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

/** The preset roles exist as ordinary roles per library, created on first use. The owner may edit them. */
async function ensurePresetRoles(libraryId: unknown) {
  for (const p of PRESET_ROLES)
    await LibraryRole.updateOne({ libraryId, key: p.key }, { $setOnInsert: { name: p.name, description: p.description, permissions: p.permissions, preset: true } }, { upsert: true });
}

/** What the signed-in person can see and do. Drives the menus; every route still checks for itself. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role === "super-admin") return request.nextUrl.searchParams.get("view") === "manage" ? err("Platform administrators manage modules from the platform screens", 403) : NextResponse.json({ kind: "platform", permissions: [], modules: null });
  const a = await accessFor(user);
  const base = { kind: a.kind, roleName: a.roleName ?? null, modules: a.modules, permissions: a.kind === "owner" ? PERMISSION_KEYS : [...a.permissions] };
  if (request.nextUrl.searchParams.get("view") !== "manage") return NextResponse.json(base);

  if (user.role !== "owner" || !user.libraryId) return err("Owner access required", 403);
  const libraryId = user.libraryId;
  await ensurePresetRoles(libraryId);
  const [roles, staff, modules] = await Promise.all([
    LibraryRole.find({ libraryId }).sort({ preset: -1, name: 1 }).lean<(Lean & { key: string; name: string; description: string; permissions: string[]; preset: boolean })[]>(),
    StaffMembership.find({ libraryId }).lean<(Lean & { userId: unknown; permissions?: string[]; roleId?: unknown })[]>(),
    moduleStates(libraryId).catch(() => null),
  ]);
  const people = await User.find({ _id: { $in: staff.map((s) => s.userId) }, libraryId, role: "staff" }).select("name email").lean<(Lean & { name: string; email: string })[]>();
  return NextResponse.json({
    ...base,
    roles,
    staff: people.map((p) => {
      const m = staff.find((s) => String(s.userId) === String(p._id))!;
      const role = roles.find((r) => String(r._id) === String(m.roleId));
      return { userId: String(p._id), name: p.name, email: p.email, roleId: m.roleId ? String(m.roleId) : null, roleName: role?.name ?? (m.roleId ? "Role removed (no access)" : "Previous fixed access"), legacy: m.permissions ?? [] };
    }),
    catalog: PERMISSION_KEYS.map((k) => ({ key: k, ...PERMISSIONS[k] })),
    registry: MODULE_KEYS.map((k) => ({ key: k, ...MODULES[k], dependents: dependents(k), state: modules?.[k] ?? { enabled: false, reason: "platform" } })),
    disabled: (await Library.findById(libraryId).select("disabledModules").lean<{ disabledModules?: string[] }>())?.disabledModules ?? [],
  });
}

/** Owner-only: module switches, roles and who has which role. */
export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role !== "owner" || !user.libraryId) return err("Only the library owner can change this", 403);
  if (limited(`access:${user._id}`, 40)) return err("Please slow down", 429);
  const libraryId = user.libraryId;
  try {
    const body = z.object({ action: z.string(), data: z.unknown().default({}) }).parse(await request.json());
    await assertWritable(libraryId);
    let recordId: unknown = libraryId;

    if (body.action === "module-set") {
      const v = z.object({ module: z.string(), enabled: z.boolean() }).parse(body.data);
      if (!isModuleKey(v.module)) throw new Error("Unknown module");
      // Only the owner's own switch is stored; plan and platform limits are applied on top and cannot be overridden here.
      await Library.updateOne({ _id: libraryId }, v.enabled ? { $pull: { disabledModules: v.module } } : { $addToSet: { disabledModules: v.module } });
      await AuditLog.create({ libraryId, actorId: user._id, action: `module.${v.enabled ? "on" : "off"}:${v.module}`, recordId: libraryId });
      return NextResponse.json({ ok: true, modules: await moduleStates(libraryId) });
    }

    if (body.action === "role-save") {
      const v = z.object({ id: objectId.optional(), name: z.string().trim().min(2).max(40), description: z.string().trim().max(200).default(""), permissions: z.array(z.string()).max(60) }).parse(body.data);
      const unknown = v.permissions.filter((p) => !isPermission(p));
      if (unknown.length) throw new Error(`Unknown permission: ${unknown[0]}`);
      const permissions = [...new Set(v.permissions)];
      if (v.id) {
        const role = await LibraryRole.findOneAndUpdate({ _id: v.id, libraryId }, { name: v.name, description: v.description, permissions }, { new: true });
        if (!role) throw new Error("Role not found");
        recordId = role._id;
      } else {
        const key = slug(v.name);
        if (!key) throw new Error("Give the role a name");
        if (await LibraryRole.exists({ libraryId, key })) throw new Error("A role with that name already exists");
        recordId = (await LibraryRole.create({ libraryId, key, name: v.name, description: v.description, permissions, createdBy: user._id }))._id;
      }
    } else if (body.action === "role-delete") {
      const v = z.object({ id: objectId }).parse(body.data);
      const role = await LibraryRole.findOne({ _id: v.id, libraryId }).lean<{ preset: boolean }>();
      if (!role) throw new Error("Role not found");
      if (role.preset) throw new Error("The ready-made roles cannot be deleted. Edit them instead.");
      if (await StaffMembership.exists({ libraryId, roleId: v.id })) throw new Error("Move the staff on this role to another role first");
      await LibraryRole.deleteOne({ _id: v.id, libraryId });
      recordId = new Types.ObjectId(v.id);
    } else if (body.action === "staff-assign") {
      const v = z.object({ email: z.email(), roleId: objectId.nullable() }).parse(body.data);
      const member = await User.findOne({ email: v.email.toLowerCase(), libraryId, deletedAt: { $exists: false } });
      if (!member || !["student", "staff"].includes(member.role)) throw new Error("Use an eligible registered account from this library");
      if (v.roleId && !(await LibraryRole.exists({ _id: v.roleId, libraryId }))) throw new Error("Role not found");
      if (v.roleId && member.role === "student" && (await Membership.exists({ userId: member._id, status: "active" })))
        throw new Error("An active student membership cannot become a staff account");
      const session = await mongoose.startSession();
      try {
        await session.withTransaction(async () => {
          if (v.roleId) {
            member.role = "staff";
            await member.save({ session });
            await StaffMembership.updateOne({ libraryId, userId: member._id }, { $set: { roleId: v.roleId } }, { upsert: true, session });
          } else {
            if (member.role === "staff") { member.role = "student"; await member.save({ session }); }
            await StaffMembership.deleteOne({ libraryId, userId: member._id }, { session });
          }
        });
      } finally { await session.endSession(); }
      recordId = member._id;
    } else throw new Error("Unsupported action");

    await AuditLog.create({ libraryId, actorId: user._id, action: `access.${body.action}`, recordId });
    return NextResponse.json({ ok: true });
  } catch (e) {
    reportUnexpected(e, "/api/access");
    if (e instanceof PlanError) return err(e.message, 402, e.code);
    if ((e as { code?: number }).code === 11000) return err("A role with that name already exists");
    return err(e instanceof z.ZodError ? e.issues[0]?.message || "Check your entries" : e instanceof Error ? e.message : "Unable to save", e instanceof z.ZodError ? 422 : 400);
  }
}
