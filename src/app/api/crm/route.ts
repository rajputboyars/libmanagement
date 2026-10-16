import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { StaffMembership, User } from "@/lib/models";
import { AdmissionLead, FollowUpTask } from "@/lib/saas-models";
import { canMoveLead, leadKey, rate } from "@/lib/saas";
import { PlanError, audit, requireFeature, ensureOrganizationForLibrary } from "@/lib/saas-server";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400, code?: string) => NextResponse.json({ error: message, ...(code ? { code } : {}) }, { status });
const STAGES = ["new", "contacted", "visit-scheduled", "converted", "lost"] as const;
type Lean = Record<string, unknown> & { _id: unknown };

async function guard() {
  const user = await currentUser();
  if (!user) return { error: err("Sign in required", 401) };
  if (!["owner", "staff"].includes(user.role) || !user.libraryId) return { error: err("Library team access required", 403) };
  if (user.role === "staff") {
    const m = await StaffMembership.findOne({ userId: user._id, libraryId: user.libraryId }).lean<{ permissions: string[] }>();
    if (!m?.permissions.includes("students")) return { error: err("You need the students permission for admissions", 403) };
  }
  return { user };
}

export async function GET(request: NextRequest) {
  const g = await guard();
  if ("error" in g) return g.error;
  const { user } = g;
  const libraryId = user.libraryId!;
  try { await requireFeature(libraryId, "crm", "Admission CRM"); } catch (e) { if (e instanceof PlanError) return err(e.message, 402, e.code); throw e; }
  const days = Math.min(365, Math.max(7, Number(request.nextUrl.searchParams.get("days") || 90)));
  const since = new Date(Date.now() - days * 86400000);
  const [leads, tasks, staff, recent] = await Promise.all([
    AdmissionLead.find({ libraryId }).sort({ updatedAt: -1 }).limit(300).lean<Lean[]>(),
    FollowUpTask.find({ libraryId, done: false }).sort({ dueAt: 1 }).limit(100).lean<Lean[]>(),
    User.find({ libraryId, role: { $in: ["owner", "staff"] } }).select("name").lean<Lean[]>(),
    AdmissionLead.find({ libraryId, createdAt: { $gte: since } }).select("stage source").lean<{ stage: string; source: string }[]>(),
  ]);
  const bySource = Object.entries(recent.reduce<Record<string, { total: number; converted: number }>>((all, l) => { const s = (all[l.source] ??= { total: 0, converted: 0 }); s.total++; if (l.stage === "converted") s.converted++; return all; }, {})).map(([source, v]) => ({ source, ...v, conversionPct: rate(v.converted, v.total) }));
  return NextResponse.json({
    stages: STAGES, leads, tasks, staff,
    stats: { windowDays: days, total: recent.length, converted: recent.filter((l) => l.stage === "converted").length, conversionPct: rate(recent.filter((l) => l.stage === "converted").length, recent.length), bySource },
    overdue: tasks.filter((t) => new Date(t.dueAt as string) < new Date()).length,
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const g = await guard();
  if ("error" in g) return g.error;
  const { user } = g;
  const libraryId = user.libraryId!;
  if (limited(`crm:${user._id}`, 60)) return err("Please slow down", 429);
  try {
    await requireFeature(libraryId, "crm", "Admission CRM");
    const orgId = await ensureOrganizationForLibrary(libraryId);
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    let record: unknown = {};
    const own = async (id: string) => { const l = await AdmissionLead.findOne({ _id: id, libraryId }); if (!l) throw new Error("Lead not found"); return l; };
    switch (body.action) {
      case "lead-create": {
        const v = z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().max(20).default(""), email: z.union([z.literal(""), z.email()]).default(""), message: z.string().trim().max(500).default(""), source: z.enum(["website", "walk-in", "referral", "social", "campaign", "other"]).default("walk-in"), campaign: z.string().trim().max(60).default(""), consentContact: z.boolean().default(false) }).parse(body.data);
        const key = leadKey(v.phone, v.email);
        if (!key) throw new Error("Enter a phone number (10 digits) or an email");
        const existing = await AdmissionLead.findOne({ libraryId, dedupeKey: key });
        if (existing) throw new Error(`This enquiry already exists (${existing.name}, stage ${existing.stage})`);
        record = await AdmissionLead.create({ ...v, libraryId, organizationId: orgId, dedupeKey: key, assignedTo: user._id, consentAt: v.consentContact ? new Date() : undefined, history: [{ at: new Date(), stage: "new", by: user._id, note: "Created by staff" }] });
        break;
      }
      case "lead-move": {
        const v = z.object({ id: objectId, stage: z.enum(STAGES), note: z.string().trim().max(200).default(""), visitAt: z.iso.datetime().optional(), lostReason: z.string().trim().max(200).default("") }).parse(body.data);
        const lead = await own(v.id);
        if (!canMoveLead(lead.stage, v.stage)) throw new Error(`A lead cannot move from ${lead.stage} to ${v.stage}`);
        if (v.stage === "visit-scheduled") { if (!v.visitAt || new Date(v.visitAt) < new Date()) throw new Error("Choose a future visit time"); lead.visitAt = new Date(v.visitAt); }
        if (v.stage === "lost" && !v.lostReason) throw new Error("Add a reason for losing this lead");
        lead.stage = v.stage; lead.lostReason = v.stage === "lost" ? v.lostReason : ""; lead.history.push({ at: new Date(), stage: v.stage, by: user._id, note: v.note } as never);
        await lead.save(); record = lead;
        break;
      }
      case "lead-assign": {
        const v = z.object({ id: objectId, userId: objectId }).parse(body.data);
        const lead = await own(v.id);
        if (!(await User.exists({ _id: v.userId, libraryId, role: { $in: ["owner", "staff"] } }))) throw new Error("Choose a member of this branch");
        lead.assignedTo = v.userId as never; await lead.save(); record = lead;
        break;
      }
      case "task-create": {
        const v = z.object({ leadId: objectId, dueAt: z.iso.datetime(), note: z.string().trim().max(200).default(""), assignedTo: objectId.optional() }).parse(body.data);
        await own(v.leadId);
        record = await FollowUpTask.create({ libraryId, leadId: v.leadId, dueAt: new Date(v.dueAt), note: v.note, assignedTo: v.assignedTo ?? user._id });
        break;
      }
      case "task-done": {
        const v = z.object({ id: objectId }).parse(body.data);
        record = await FollowUpTask.findOneAndUpdate({ _id: v.id, libraryId, done: false }, { done: true, doneAt: new Date() }, { new: true });
        if (!record) throw new Error("Task not found");
        break;
      }
      default: throw new Error("Unsupported action");
    }
    await audit({ organizationId: orgId as never, actorId: user._id, actorRole: user.role, action: `crm.${body.action}` });
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    if (error instanceof PlanError) return err(error.message, 402, error.code);
    return err(error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update", error instanceof z.ZodError ? 422 : 400);
  }
}
