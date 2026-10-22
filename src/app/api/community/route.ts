import { studentFeatureBlocked } from "@/lib/student-access-server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AuditLog, CommunityBlock, CommunityLink, CommunityProfile, CommunityReport, Notification, StudentExam, SuccessPost } from "@/lib/models";
import { AGE_BANDS, MENTORSHIP, MILESTONE_TYPES, REPORT_REASONS, VISIBILITY, buddyScore, containsContactInfo, headline, pairKey, type MilestoneType } from "@/lib/community";
import { blockedBetween, canViewPost, mayInteract, verifiedStats, type ExamDoc, type PostDoc, type ProfileDoc } from "@/lib/community-server";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const team = (role: string) => role === "owner" || role === "staff";
const safeText = (max: number, min = 0) => z.string().trim().min(min).max(max).refine((v) => !containsContactInfo(v), "Remove emails, links, handles and phone numbers");

async function aliasMap(ids: unknown[]) {
  const rows = await CommunityProfile.find({ userId: { $in: ids } }).select("userId alias").lean();
  return new Map(rows.map((row) => [String(row.userId), row.alias as string]));
}

export async function GET(request: NextRequest) {
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "social"); if (blocked) return blocked; }
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!user.libraryId) return NextResponse.json({ error: "Join a library first" }, { status: 400 });
  const view = request.nextUrl.searchParams.get("view") || "hub";
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const libraryId = user.libraryId;

  if (view === "moderation") {
    if (!team(user.role)) return NextResponse.json({ error: "Library team access required" }, { status: 403 });
    const [reports, consents, suspended] = await Promise.all([
      CommunityReport.find({ libraryId, status: "open" }).sort({ createdAt: 1 }).limit(50).lean(),
      CommunityProfile.find({ libraryId, consentStatus: "pending" }).select("+guardianContact userId alias guardianName createdAt").limit(50).lean(),
      CommunityProfile.find({ libraryId, moderation: "suspended" }).select("userId alias moderationNote").limit(50).lean(),
    ]);
    const aliases = await aliasMap(reports.flatMap((r) => [r.targetUserId, r.reporterId]).filter(Boolean));
    const posts = await SuccessPost.find({ _id: { $in: reports.map((r) => r.postId).filter(Boolean) } }).lean();
    return NextResponse.json({
      reports: reports.map((r) => ({ ...r, targetAlias: aliases.get(String(r.targetUserId)) || "Member", reporterAlias: aliases.get(String(r.reporterId)) || "Member", post: posts.find((p) => String(p._id) === String(r.postId)) || null })),
      consents, suspended,
    });
  }
  if (user.role !== "student") return NextResponse.json({ error: "Student access required" }, { status: 403 });
  const profile = await CommunityProfile.findOne({ userId: user._id }).lean<ProfileDoc>();
  const active = mayInteract(profile);

  if (view === "wall") {
    if (!active) return NextResponse.json({ posts: [], mine: [], page, locked: true });
    const blocked = await blockedBetween(user._id);
    const candidates = await SuccessPost.find({ status: "published", $or: [{ visibility: "public" }, { visibility: "library", libraryId }], userId: { $nin: [...blocked, user._id] } }).sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean();
    const authors = await CommunityProfile.find({ userId: { $in: candidates.map((p) => p.userId) } }).select("userId alias ageBand optedIn moderation consentStatus").lean<ProfileDoc[]>();
    const byUser = new Map(authors.map((a) => [String(a.userId), a]));
    const posts = candidates.filter((p) => { const a = byUser.get(String(p.userId)); return mayInteract(a) && (p.visibility !== "public" || a?.ageBand === "adult"); })
      .map((p) => ({ _id: p._id, alias: byUser.get(String(p.userId))?.alias, headline: headline(p.milestoneType as MilestoneType, p.milestoneValue), message: p.message, visibility: p.visibility, createdAt: p.createdAt }));
    const mine = await SuccessPost.find({ userId: user._id }).sort({ createdAt: -1 }).limit(50).lean();
    const { stats, rungs } = await verifiedStats(user._id);
    return NextResponse.json({ posts, mine: mine.map((p) => ({ ...p, headline: headline(p.milestoneType as MilestoneType, p.milestoneValue) })), stats, rungs, page });
  }

  // hub
  const blockRows = await CommunityBlock.find({ userId: user._id }).lean();
  const blockAliases = await aliasMap(blockRows.map((b) => b.blockedId));
  const out: Record<string, unknown> = { profile, hasExam: !!(await StudentExam.exists({ userId: user._id })), blocks: blockRows.map((b) => ({ userId: b.blockedId, alias: blockAliases.get(String(b.blockedId)) || "Member" })) };
  if (!active || !profile) return NextResponse.json({ ...out, buddies: [], mentors: [], group: null, links: [] });
  const exam = await StudentExam.findOne({ userId: user._id }).lean<ExamDoc>();
  const blocked = await blockedBetween(user._id);
  const links = await CommunityLink.find({ $or: [{ fromId: user._id }, { toId: user._id }], status: { $in: ["pending", "accepted"] } }).lean();
  const linked = new Set(links.flatMap((l) => [String(l.fromId), String(l.toId)]));
  const peers = await CommunityProfile.find({ libraryId, optedIn: true, moderation: "active", consentStatus: { $in: ["not-required", "approved"] }, ageBand: profile.ageBand, userId: { $ne: user._id, $nin: [...blocked] } }).select("userId alias sharedGoal lookingForBuddy mentorship").limit(200).lean();
  const exams = await StudentExam.find({ userId: { $in: peers.map((p) => p.userId) }, examKey: exam?.examKey }).lean<(ExamDoc & { userId: unknown })[]>();
  const examBy = new Map(exams.map((e) => [String(e.userId), e]));
  const sameExam = peers.filter((p) => examBy.has(String(p.userId)));
  const mySubjects = new Set((exam?.subjectIds || []).map(String));
  const score = (p: (typeof peers)[number]) => { const e = examBy.get(String(p.userId))!; return buddyScore({ weeklyMinutes: exam?.weeklyMinutes || 600 }, { userId: String(p.userId), examKey: e.examKey, weeklyMinutes: e.weeklyMinutes, sharedSubjects: (e.subjectIds || []).filter((s: unknown) => mySubjects.has(String(s))).length }); };
  const shape = (p: (typeof peers)[number]) => ({ userId: p.userId, alias: p.alias, sharedGoal: p.sharedGoal, score: score(p) });
  const aliases = await aliasMap([...linked].filter((id) => id !== String(user._id)));
  return NextResponse.json({
    ...out,
    buddies: profile.lookingForBuddy ? sameExam.filter((p) => p.lookingForBuddy && !linked.has(String(p.userId))).map(shape).sort((a, b) => b.score - a.score).slice(0, 10) : [],
    mentors: profile.mentorship === "seeking" ? sameExam.filter((p) => p.mentorship === "offering" && !linked.has(String(p.userId))).map(shape).slice(0, 10) : [],
    group: exam ? { examKey: exam.examKey, count: sameExam.length + 1, members: sameExam.slice(0, 30).map((p) => ({ userId: p.userId, alias: p.alias, sharedGoal: p.sharedGoal })) } : null,
    links: links.map((l) => ({ _id: l._id, kind: l.kind, status: l.status, incoming: String(l.toId) === String(user._id), alias: aliases.get(String(String(l.toId) === String(user._id) ? l.fromId : l.toId)) || "Member" })),
  });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "social"); if (blocked) return blocked; }
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (!user.libraryId) return NextResponse.json({ error: "Join a library first" }, { status: 400 });
  if (limited(`community:${user._id}`, 30)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  const libraryId = user.libraryId;
  const audit = (action: string, recordId?: unknown) => AuditLog.create({ libraryId, actorId: user._id, action, recordId });
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    let record: unknown;

    if (body.action.startsWith("mod-")) {
      if (!team(user.role)) throw new Error("Library team access required");
      if (body.action === "mod-report") {
        const v = z.object({ id: objectId, decision: z.enum(["dismiss", "remove-post", "suspend-member"]), note: z.string().trim().max(300).default("") }).parse(body.data);
        const report = await CommunityReport.findOne({ _id: v.id, libraryId, status: "open" });
        if (!report) throw new Error("Open report not found");
        if (v.decision === "remove-post") {
          if (!report.postId) throw new Error("This report has no post");
          await SuccessPost.updateOne({ _id: report.postId, libraryId }, { status: "removed", removedReason: v.note || "Removed by moderator" });
        }
        if (v.decision === "suspend-member") {
          if (!report.targetUserId) throw new Error("This report has no member");
          await CommunityProfile.updateOne({ userId: report.targetUserId, libraryId }, { moderation: "suspended", moderationNote: v.note });
        }
        report.status = v.decision === "dismiss" ? "dismissed" : "actioned";
        report.resolution = v.note || v.decision;
        report.resolvedBy = user._id;
        await report.save();
        await audit(`community-${v.decision}`, report._id);
        record = report;
      } else if (body.action === "mod-consent") {
        const v = z.object({ userId: objectId, decision: z.enum(["approved", "rejected"]) }).parse(body.data);
        record = await CommunityProfile.findOneAndUpdate({ userId: v.userId, libraryId, ageBand: "minor", consentStatus: "pending" }, { consentStatus: v.decision }, { new: true });
        if (!record) throw new Error("Pending consent not found");
        await Notification.create({ libraryId, userId: v.userId, title: "Community access", message: v.decision === "approved" ? "Guardian consent was confirmed. You can use community features." : "Guardian consent was not confirmed. Speak to the library team." });
        await audit(`community-consent-${v.decision}`, (record as { _id: unknown })._id);
      } else if (body.action === "mod-member") {
        const v = z.object({ userId: objectId, decision: z.enum(["suspend", "restore"]), note: z.string().trim().max(300).default("") }).parse(body.data);
        record = await CommunityProfile.findOneAndUpdate({ userId: v.userId, libraryId }, { moderation: v.decision === "suspend" ? "suspended" : "active", moderationNote: v.decision === "suspend" ? v.note : "" }, { new: true });
        if (!record) throw new Error("Member not found");
        await audit(`community-${v.decision}`, (record as { _id: unknown })._id);
      } else throw new Error("Unsupported action");
      return NextResponse.json({ ok: true, record });
    }

    if (user.role !== "student") throw new Error("Student access required");
    const mine = await CommunityProfile.findOne({ userId: user._id });

    if (body.action === "profile-save") {
      const v = z.object({
        optedIn: z.boolean(), alias: safeText(30, 3), ageBand: z.enum(AGE_BANDS), guardianName: safeText(80).default(""), guardianContact: z.string().trim().max(80).default(""),
        lookingForBuddy: z.boolean().default(false), mentorship: z.enum(MENTORSHIP).default("none"), sharedGoal: safeText(140).default(""),
      }).parse(body.data);
      if (v.optedIn && !await StudentExam.exists({ userId: user._id })) throw new Error("Set your exam target first so groups can be matched");
      if (mine?.ageBand === "minor" && v.ageBand === "adult") throw new Error("Ask your library team to change your age group");
      if (v.ageBand === "minor" && v.optedIn && (!v.guardianName || v.guardianContact.length < 5) && mine?.consentStatus !== "approved") throw new Error("A guardian name and contact are required for members under 18");
      const lower = v.alias.toLowerCase();
      const clash = await CommunityProfile.exists({ libraryId, alias: new RegExp(`^${lower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"), userId: { $ne: user._id } });
      if (clash) throw new Error("That alias is taken in your library");
      const guardianChanged = !!mine && (mine.guardianName !== v.guardianName);
      const consentStatus = v.ageBand === "adult" ? "not-required" : mine?.consentStatus && mine.consentStatus !== "not-required" && !guardianChanged ? mine.consentStatus : "pending";
      const set = { libraryId, optedIn: v.optedIn, alias: v.alias, ageBand: v.ageBand, consentStatus, guardianName: v.ageBand === "minor" ? v.guardianName : "", lookingForBuddy: v.optedIn && v.lookingForBuddy, mentorship: v.optedIn ? v.mentorship : "none", sharedGoal: v.sharedGoal, ...(v.ageBand === "minor" && v.guardianContact ? { guardianContact: v.guardianContact } : {}) };
      record = await CommunityProfile.findOneAndUpdate({ userId: user._id }, { $set: set, $setOnInsert: { moderation: "active" } }, { upsert: true, new: true, runValidators: true });
      if (!v.optedIn) {
        await SuccessPost.updateMany({ userId: user._id, visibility: { $ne: "private" } }, { visibility: "private" });
        await CommunityLink.updateMany({ $or: [{ fromId: user._id }, { toId: user._id }], status: { $in: ["pending", "accepted"] } }, { status: "ended" });
      }
      await audit("community-profile", (record as { _id: unknown })._id);
      return NextResponse.json({ ok: true, record: await CommunityProfile.findById((record as { _id: unknown })._id).lean() });
    }

    if (body.action === "report") {
      const v = z.object({ targetUserId: objectId.optional(), postId: objectId.optional(), reason: z.enum(REPORT_REASONS), detail: z.string().trim().max(400).default("") }).parse(body.data);
      if (!v.targetUserId && !v.postId) throw new Error("Choose a member or post to report");
      let target = v.targetUserId;
      if (v.postId) {
        const post = await SuccessPost.findById(v.postId).lean<PostDoc>();
        if (!post || !await canViewPost(post, user)) throw new Error("Post not found");
        target = String(post.userId);
      }
      if (target === String(user._id)) throw new Error("You cannot report yourself");
      const targetProfile = await CommunityProfile.findOne({ userId: target, libraryId }).lean<ProfileDoc>();
      if (!targetProfile) throw new Error("Member not found");
      try { record = await CommunityReport.create({ libraryId, reporterId: user._id, targetUserId: target, postId: v.postId, reason: v.reason, detail: v.detail }); }
      catch { throw new Error("You already reported this"); }
      await audit("community-report", (record as { _id: unknown })._id);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "block" || body.action === "unblock") {
      const v = z.object({ userId: objectId }).parse(body.data);
      if (v.userId === String(user._id)) throw new Error("You cannot block yourself");
      if (body.action === "block") {
        await CommunityBlock.updateOne({ userId: user._id, blockedId: v.userId }, { $setOnInsert: {} }, { upsert: true });
        await CommunityLink.updateMany({ $or: [{ fromId: user._id, toId: v.userId }, { fromId: v.userId, toId: user._id }], status: { $in: ["pending", "accepted"] } }, { status: "ended" });
      } else await CommunityBlock.deleteOne({ userId: user._id, blockedId: v.userId });
      await audit(`community-${body.action}`);
      return NextResponse.json({ ok: true });
    }

    if (body.action === "link-end") {
      const v = z.object({ id: objectId }).parse(body.data);
      record = await CommunityLink.findOneAndUpdate({ _id: v.id, $or: [{ fromId: user._id }, { toId: user._id }], status: { $in: ["pending", "accepted"] } }, { status: "ended" }, { new: true });
      if (!record) throw new Error("Connection not found");
      return NextResponse.json({ ok: true });
    }

    // Remaining actions require an active, consented member.
    if (!mayInteract(mine) || !mine) throw new Error("Turn on community sharing first (guardian approval is needed under 18)");

    if (body.action === "buddy-request" || body.action === "mentor-request") {
      const v = z.object({ userId: objectId }).parse(body.data);
      const kind = body.action === "buddy-request" ? "buddy" : "mentorship";
      const [peer, blocked, myExam, theirExam] = await Promise.all([CommunityProfile.findOne({ userId: v.userId, libraryId }).lean<ProfileDoc>(), blockedBetween(user._id), StudentExam.findOne({ userId: user._id }).lean<ExamDoc>(), StudentExam.findOne({ userId: v.userId }).lean<ExamDoc>()]);
      if (!mayInteract(peer) || !peer || peer.ageBand !== mine.ageBand || blocked.has(v.userId)) throw new Error("This member is not available");
      if (!myExam || !theirExam || myExam.examKey !== theirExam.examKey) throw new Error("Members must share an exam group");
      if (kind === "buddy" && !(peer.lookingForBuddy && mine.lookingForBuddy)) throw new Error("Both members must be looking for a buddy");
      if (kind === "mentorship" && !(mine.mentorship === "seeking" && peer.mentorship === "offering")) throw new Error("Choose a member who is offering mentorship");
      const key = pairKey(kind, String(user._id), v.userId);
      const existing = await CommunityLink.findOne({ pairKey: key });
      if (existing && ["pending", "accepted"].includes(existing.status)) throw new Error("A connection already exists");
      record = existing ? await CommunityLink.findOneAndUpdate({ _id: existing._id }, { status: "pending", fromId: user._id, toId: v.userId }, { new: true }) : await CommunityLink.create({ libraryId, kind, fromId: user._id, toId: v.userId, pairKey: key });
      await Notification.create({ libraryId, userId: v.userId, title: kind === "buddy" ? "Study buddy request" : "Mentorship request", message: `${mine.alias} would like to connect. Review it in Community.` });
      await audit(`community-${kind}-request`);
    } else if (body.action === "link-respond") {
      const v = z.object({ id: objectId, accept: z.boolean() }).parse(body.data);
      record = await CommunityLink.findOneAndUpdate({ _id: v.id, toId: user._id, status: "pending" }, { status: v.accept ? "accepted" : "declined" }, { new: true });
      if (!record) throw new Error("Request not found");
    } else if (body.action === "post-create") {
      const v = z.object({ milestoneType: z.enum(MILESTONE_TYPES), milestoneValue: z.number().int(), message: safeText(140).default(""), visibility: z.enum(VISIBILITY), consent: z.literal(true, { error: "Confirm that you agree to share this" }) }).parse(body.data);
      if (v.visibility === "public" && mine.ageBand !== "adult") throw new Error("Public sharing is only available to members 18 and over");
      const { rungs } = await verifiedStats(user._id);
      if (!rungs[v.milestoneType].includes(v.milestoneValue)) throw new Error("That milestone is not verified for your account");
      try { record = await SuccessPost.create({ libraryId, userId: user._id, milestoneType: v.milestoneType, milestoneValue: v.milestoneValue, message: v.message, visibility: v.visibility, consentAt: new Date() }); }
      catch { throw new Error("You already created a card for this milestone"); }
      await audit("community-post", (record as { _id: unknown })._id);
    } else if (body.action === "post-update") {
      const v = z.object({ id: objectId, visibility: z.enum(VISIBILITY) }).parse(body.data);
      if (v.visibility === "public" && mine.ageBand !== "adult") throw new Error("Public sharing is only available to members 18 and over");
      record = await SuccessPost.findOneAndUpdate({ _id: v.id, userId: user._id, status: "published" }, { visibility: v.visibility }, { new: true });
      if (!record) throw new Error("Card not found");
    } else if (body.action === "post-delete") {
      const v = z.object({ id: objectId }).parse(body.data);
      const gone = await SuccessPost.deleteOne({ _id: v.id, userId: user._id });
      if (!gone.deletedCount) throw new Error("Card not found");
    } else throw new Error("Unsupported action");
    return NextResponse.json({ ok: true, record });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update community" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
