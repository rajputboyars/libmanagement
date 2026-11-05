import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { MODULES, MODULE_KEYS, isModuleKey } from "@/lib/modules";
import { Organization, PlatformSettings } from "@/lib/saas-models";
import { audit } from "@/lib/saas-server";

const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const keys = z.array(z.string()).max(40).transform((list) => [...new Set(list)]).refine((list) => list.every(isModuleKey), "Unknown module");

/** Platform administrators only. This decides which modules exist for an organization; libraries then switch their own on or off inside that. */
async function admin() {
  const user = await currentUser();
  return user && user.role === "super-admin" ? user : null;
}

export async function GET(request: NextRequest) {
  if (!(await admin())) return err("Platform administrator access required", 403);
  const page = Math.max(1, Math.min(1000, Number(request.nextUrl.searchParams.get("page")) || 1));
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const filter = q ? { name: { $regex: q, $options: "i" } } : {};
  const [settings, total, orgs] = await Promise.all([
    PlatformSettings.findOne({ key: "default" }).select("blockedModules").lean<{ blockedModules?: string[] }>(),
    Organization.countDocuments(filter),
    Organization.find(filter).sort({ createdAt: -1 }).skip((page - 1) * 25).limit(25).select("name blockedModules").lean<{ _id: unknown; name: string; blockedModules?: string[] }[]>(),
  ]);
  return NextResponse.json({
    modules: MODULE_KEYS.map((k) => ({ key: k, name: MODULES[k].name, description: MODULES[k].description })),
    global: settings?.blockedModules ?? [], total, page,
    items: orgs.map((o) => ({ _id: String(o._id), name: o.name, blocked: o.blockedModules ?? [] })),
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await admin();
  if (!user) return err("Platform administrator access required", 403);
  if (limited(`platform-modules:${user._id}`, 60)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.enum(["global-set", "org-set"]), data: z.unknown() }).parse(await request.json());
    if (body.action === "global-set") {
      const v = z.object({ blocked: keys }).parse(body.data);
      await PlatformSettings.updateOne({ key: "default" }, { $set: { blockedModules: v.blocked } }, { upsert: true });
      await audit({ actorId: user._id, actorRole: "super-admin", action: "modules.global", details: v });
    } else {
      const v = z.object({ organizationId: objectId, blocked: keys }).parse(body.data);
      const org = await Organization.findByIdAndUpdate(v.organizationId, { $set: { blockedModules: v.blocked } });
      if (!org) throw new Error("Organization not found");
      await audit({ organizationId: v.organizationId, actorId: user._id, actorRole: "super-admin", action: "modules.org", details: v });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err(e.issues[0]?.message ?? "Invalid request");
    return err(e instanceof Error ? e.message : "Could not save");
  }
}
