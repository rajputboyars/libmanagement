import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AuditLog, Notification, StaffMembership, StudentNote } from "@/lib/models";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type NoteRow = { _id: unknown; userId: unknown; title: string; body: string; tags?: string[]; authorName?: string; sharedAt?: Date; moderation?: string; hiddenReason?: string };

/** Owners always; staff with the students permission. */
async function team(user: { _id: unknown; role: string; libraryId?: unknown }) {
  if (user.role === "owner" && user.libraryId) return true;
  if (user.role !== "staff" || !user.libraryId) return false;
  const m = await StaffMembership.findOne({ userId: user._id, libraryId: user.libraryId }).lean<{ permissions: string[] }>();
  return !!m?.permissions.includes("students");
}

/** Students: notes shared in their library (hidden ones only if they wrote them). Team: every shared note, with moderation. */
export async function GET(request: NextRequest) {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (!user.libraryId) return NextResponse.json({ team: false, notes: [] });
  const isTeam = await team(user);
  const q = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 60);
  const filter: Record<string, unknown> = { libraryId: user.libraryId, shared: true };
  if (!isTeam) filter.$or = [{ moderation: "active" }, { userId: user._id }];
  if (q) filter.$and = [{ $or: [{ title: new RegExp(escapeRegex(q), "i") }, { body: new RegExp(escapeRegex(q), "i") }, { tags: q.toLowerCase() }] }];
  const notes = await StudentNote.find(filter).sort({ sharedAt: -1 }).limit(60).select("userId title body tags authorName sharedAt moderation hiddenReason").lean<NoteRow[]>();
  return NextResponse.json({
    team: isTeam,
    notes: notes.map((n) => ({
      _id: n._id,
      title: n.title,
      body: n.body,
      tags: n.tags ?? [],
      author: n.authorName || "Student",
      sharedAt: n.sharedAt,
      mine: String(n.userId) === String(user._id),
      hidden: n.moderation === "hidden",
      hiddenReason: isTeam || String(n.userId) === String(user._id) ? n.hiddenReason ?? "" : "",
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`shared-notes:${user._id}`, 40)) return err("Please slow down", 429);
  if (!user.libraryId || !(await team(user))) return err("Only the library team can moderate notes", 403);
  try {
    const body = await request.json();
    const action = z.enum(["hide", "restore"]).parse(body.action);
    const v = z.object({ id: objectId, reason: z.string().trim().max(200).default("") }).parse(body.data);
    if (action === "hide" && v.reason.length < 3) throw new Error("Give a short reason the student will see");
    const note = await StudentNote.findOneAndUpdate(
      { _id: v.id, libraryId: user.libraryId, shared: true },
      { $set: action === "hide" ? { moderation: "hidden", hiddenReason: v.reason } : { moderation: "active", hiddenReason: "" } },
      { new: true },
    ).lean<NoteRow>();
    if (!note) return err("Note not found", 404);
    await AuditLog.create({ libraryId: user.libraryId, actorId: user._id, action: `note.${action}`, recordId: note._id });
    if (action === "hide")
      await Notification.create({ userId: note.userId, libraryId: user.libraryId, title: "Shared note hidden", message: `Your library hid “${note.title}” from classmates: ${v.reason}` });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err(e.issues[0]?.message ?? "Invalid request");
    return err(e instanceof Error ? e.message : "Could not save");
  }
}
