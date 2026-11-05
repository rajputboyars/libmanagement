import { NextResponse } from "next/server";
import type { Types } from "mongoose";
import { Library, LibraryRole, StaffMembership } from "./models";
import { MODULES, resolveModules, type ModuleKey, type ModuleState } from "./modules";
import { isPermission, staffPermissions, type PermissionKey } from "./permissions";
import { accessForLibrary } from "./saas-server";

type Id = Types.ObjectId | string;
type UserLike = { _id: Id; role: string; libraryId?: Id | null };

export class AccessError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = "forbidden", status = 403) { super(message); this.code = code; this.status = status; }
}

/** What a library may use right now: platform block, plan, the owner's switch and dependencies, resolved together. */
export async function moduleStates(libraryId: Id): Promise<Record<ModuleKey, ModuleState>> {
  const [lib, access] = await Promise.all([Library.findById(libraryId).select("disabledModules").lean<{ disabledModules?: string[] }>(), accessForLibrary(libraryId)]);
  if (!lib || !access) throw new Error("Library not found");
  const settings = access.settings as unknown as { blockedModules?: string[] };
  const org = access.org as unknown as { blockedModules?: string[] };
  return resolveModules({ platformBlocked: [...(settings.blockedModules ?? []), ...(org.blockedModules ?? [])], libraryDisabled: lib.disabledModules ?? [], features: access.entitlements.features });
}

export type Access = {
  kind: "owner" | "staff" | "student" | "none";
  libraryId?: Id;
  permissions: Set<PermissionKey>;
  modules: Record<ModuleKey, ModuleState> | null;
  roleName?: string;
};

/** Who this user is inside their library. Anything missing or unreadable means no access (never a default grant). */
export async function accessFor(user: UserLike | null): Promise<Access> {
  const none: Access = { kind: "none", permissions: new Set(), modules: null };
  if (!user || !user.libraryId) return none;
  const libraryId = user.libraryId;
  let kind: Access["kind"] = "none", permissions = new Set<PermissionKey>(), roleName: string | undefined;
  // Owners (also when switched to another branch of their organization, which /api/org verifies) hold every library permission.
  if (user.role === "owner") kind = "owner";
  else if (user.role === "staff") {
    const m = await StaffMembership.findOne({ userId: user._id, libraryId }).lean<{ permissions?: string[]; roleId?: Id }>();
    if (!m) return none;
    const role = m.roleId ? await LibraryRole.findOne({ _id: m.roleId, libraryId }).lean<{ name: string; permissions: string[] }>() : null;
    // A staff member whose role was deleted gets nothing, not the legacy defaults.
    if (m.roleId && !role) return { ...none, kind: "staff", libraryId };
    permissions = staffPermissions({ rolePermissions: role?.permissions ?? null, legacy: m.permissions ?? [] });
    roleName = role?.name;
    kind = "staff";
  } else if (user.role === "student") kind = "student";
  else return none;
  try {
    return { kind, libraryId, permissions, modules: await moduleStates(libraryId), roleName };
  } catch {
    return { kind: "none", libraryId, permissions: new Set(), modules: null };
  }
}

export const can = (a: Access, permission: PermissionKey) => (a.kind === "owner" ? isPermission(permission) : a.kind === "staff" && a.permissions.has(permission));
export const moduleOn = (a: Access, key: ModuleKey) => a.modules?.[key]?.enabled === true;

const REASON: Record<string, string> = {
  library: "It is turned off for this library.",
  platform: "It is not available for this library.",
  plan: "It is not included in this library's plan.",
  dependency: "Something it depends on is turned off.",
};
export function moduleMessage(key: ModuleKey, state?: ModuleState) {
  return `${MODULES[key].name} is not available. ${REASON[state?.reason ?? "platform"] ?? ""}`.trim();
}

/** A module the plan does not include answers like any other plan-gated feature (402, code "feature"); everything else is 403. */
const moduleDenied = (key: ModuleKey, state?: ModuleState) =>
  state?.reason === "plan" ? new AccessError(moduleMessage(key, state), "feature", 402) : new AccessError(moduleMessage(key, state), "module-disabled");

/** Throws unless the module is usable for the library. Used by routes that already work with throw/catch. */
export async function assertModule(libraryId: Id, key: ModuleKey) {
  let state: ModuleState | undefined;
  try { state = (await moduleStates(libraryId))[key]; } catch { throw new AccessError("Module access could not be verified.", "module-unverified", 503); }
  if (!state?.enabled) throw moduleDenied(key, state);
}

/** Throws unless the module is on and (for staff) the permission is held. Owners hold every permission. */
export async function assertTeam(user: UserLike | null, module: ModuleKey | null, permission: PermissionKey | null): Promise<Access> {
  if (!user) throw new AccessError("Sign in required", "sign-in", 401);
  const a = await accessFor(user);
  if (a.kind !== "owner" && a.kind !== "staff") throw new AccessError("Library team access required", "forbidden");
  if (module && !moduleOn(a, module)) throw moduleDenied(module, a.modules?.[module]);
  if (permission && !can(a, permission)) throw new AccessError("You do not have permission to do this.", "forbidden");
  return a;
}
/** For a student (or anyone in a library): the module must be on for their library. Students without a library are not gated. */
export async function assertMember(user: UserLike | null, module: ModuleKey): Promise<Access | null> {
  if (!user) throw new AccessError("Sign in required", "sign-in", 401);
  if (!user.libraryId) return null;
  const a = await accessFor(user);
  if (a.kind === "none") throw new AccessError("Module access could not be verified.", "module-unverified", 403);
  if (!moduleOn(a, module)) throw moduleDenied(module, a.modules?.[module]);
  return a;
}

export function accessResponse(error: unknown) {
  if (!(error instanceof AccessError)) return null;
  return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
}
/** `const denied = await guardTeam(user, "fees", "fees.view"); if (denied) return denied;` */
export async function guardTeam(user: UserLike | null, module: ModuleKey | null, permission: PermissionKey | null) {
  try { await assertTeam(user, module, permission); return null; } catch (e) { const r = accessResponse(e); if (r) return r; throw e; }
}
export async function guardMember(user: UserLike | null, module: ModuleKey) {
  try { await assertMember(user, module); return null; } catch (e) { const r = accessResponse(e); if (r) return r; throw e; }
}
