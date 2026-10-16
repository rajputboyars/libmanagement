import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { Organization, SupportTicket } from "@/lib/saas-models";
import { audit, ensureOrganizationForLibrary, verifyOrgOwner } from "@/lib/saas-server";
import { notifyOrg } from "@/lib/saas-notify";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
type Lean = Record<string, unknown> & { _id: unknown; organizationId: unknown };

export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  const p = request.nextUrl.searchParams;
  const page = Math.max(1, Number(p.get("page") || 1));
  const status = p.get("status");
  const isAdmin = user.role === "super-admin";
  let filter: Record<string, unknown> = status ? { status } : {};
  if (!isAdmin) {
    if (user.role !== "owner" || !user.libraryId) return err("Owner access required", 403);
    filter = { ...filter, organizationId: await ensureOrganizationForLibrary(user.libraryId) };
  }
  const id = p.get("id");
  if (id) {
    if (!objectId.safeParse(id).success) return err("Ticket not found", 404);
    const ticket = await SupportTicket.findOne({ ...filter, _id: id }).lean<Lean>();
    if (!ticket) return err("Ticket not found", 404);
    return NextResponse.json({ ticket });
  }
  const [items, total] = await Promise.all([SupportTicket.find(filter).sort({ updatedAt: -1 }).skip((page - 1) * 20).limit(20).select("-messages").lean<Lean[]>(), SupportTicket.countDocuments(filter)]);
  const orgs = isAdmin ? await Organization.find({ _id: { $in: items.map((i) => i.organizationId) } }).select("name").lean<Lean[]>() : [];
  return NextResponse.json({ total, page, items: items.map((i) => ({ ...i, orgName: (orgs.find((o) => String(o._id) === String(i.organizationId)) as { name?: string } | undefined)?.name })) });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`support:${user._id}`, 15)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    const admin = user.role === "super-admin";
    const now = new Date();
    if (admin) {
      if (body.action === "reply" || body.action === "status") {
        const v = z.object({ id: objectId, body: z.string().trim().max(2000).optional(), status: z.enum(["open", "pending", "resolved", "closed"]).optional() }).parse(body.data);
        const ticket = await SupportTicket.findById(v.id);
        if (!ticket) throw new Error("Ticket not found");
        if (v.body) { ticket.messages.push({ authorId: user._id, role: "admin", body: v.body, at: now } as never); if (!v.status) v.status = "pending"; }
        if (v.status && v.status !== ticket.status) { ticket.status = v.status; ticket.history.push({ status: v.status, by: user._id, at: now } as never); }
        await ticket.save();
        await audit({ organizationId: ticket.organizationId as never, actorId: user._id, actorRole: "super-admin", action: `support.${body.action}`, targetType: "ticket", targetId: String(ticket._id) });
        await notifyOrg({ organizationId: ticket.organizationId as never, key: `ticket:${ticket._id}:${ticket.messages.length}:${ticket.status}`, kind: "support", title: v.body ? "Support replied to your ticket" : `Your ticket is ${ticket.status}`, message: `“${ticket.subject}”${v.body ? " has a new reply." : ` was marked ${ticket.status}.`}` }).catch(() => null);
        return NextResponse.json({ ok: true, ticket });
      }
      throw new Error("Unsupported action");
    }
    if (user.role !== "owner" || !user.libraryId) throw new Error("Owner access required");
    const orgId = await verifyOrgOwner(user);
    if (body.action === "create") {
      const v = z.object({ subject: z.string().trim().min(5).max(120), category: z.enum(["billing", "technical", "account", "feature", "other"]).default("other"), priority: z.enum(["low", "normal", "high"]).default("normal"), body: z.string().trim().min(10).max(2000) }).parse(body.data);
      if (await SupportTicket.countDocuments({ organizationId: orgId, status: { $in: ["open", "pending"] } }) >= 20) throw new Error("You have many open tickets. Please wait for replies or close some.");
      const ticket = await SupportTicket.create({ organizationId: orgId, libraryId: user.libraryId, createdBy: user._id, subject: v.subject, category: v.category, priority: v.priority, messages: [{ authorId: user._id, role: "owner", body: v.body, at: now }], history: [{ status: "open", by: user._id, at: now }] });
      await audit({ organizationId: orgId, actorId: user._id, actorRole: "org-owner", action: "support.create", targetType: "ticket", targetId: String(ticket._id) });
      return NextResponse.json({ ok: true, ticket });
    }
    const v = z.object({ id: objectId, body: z.string().trim().min(2).max(2000).optional() }).parse(body.data);
    const ticket = await SupportTicket.findOne({ _id: v.id, organizationId: orgId });
    if (!ticket) throw new Error("Ticket not found");
    if (body.action === "reply") {
      if (!v.body) throw new Error("Write a message");
      if (ticket.status === "closed") throw new Error("This ticket is closed. Open a new one.");
      ticket.messages.push({ authorId: user._id, role: "owner", body: v.body, at: now } as never);
      if (ticket.status !== "open") { ticket.status = "open"; ticket.history.push({ status: "open", by: user._id, at: now } as never); }
    } else if (body.action === "close") { ticket.status = "closed"; ticket.history.push({ status: "closed", by: user._id, at: now } as never); }
    else throw new Error("Unsupported action");
    await ticket.save();
    return NextResponse.json({ ok: true, ticket });
  } catch (error) {
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update", error instanceof z.ZodError ? 422 : 400);
  }
}
