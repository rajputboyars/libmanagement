import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { ExamCatalog, ExamDate, Question, SyllabusNode, TestTemplate } from "@/lib/models";
import { contentHash, validateImportRow } from "@/lib/prep";
import { aiConfigured, draftQuestions } from "@/lib/prep-ai";
import { publishedFilter } from "@/lib/prep-server";

const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const examKey = z.string().trim().toLowerCase().min(2).max(40);
const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const escapeRegex = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
type Lean = Record<string, unknown> & { _id: unknown };

const sourceSchema = z.object({
  name: z.string().trim().max(120).default(""), url: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).default(""),
  year: z.number().int().min(1950).max(2100).optional(), license: z.enum(["original", "licensed", "public-domain", "ai-generated", "unknown"]).default("original"), notes: z.string().trim().max(300).default(""),
});
const transitions: Record<string, string[]> = { draft: ["in-review", "archived"], "in-review": ["published", "draft", "archived"], published: ["in-review", "archived"], archived: ["draft"] };

async function admin() {
  const user = await currentUser();
  return user && user.role === "super-admin" ? user : null;
}

export async function GET(request: NextRequest) {
  if (!await admin()) return err("Super-admin access required", 403);
  const p = request.nextUrl.searchParams;
  const view = p.get("view") || "questions";
  const page = Math.max(1, Number(p.get("page") || 1));
  const key = (p.get("examKey") || "").toLowerCase();
  if (view === "questions") {
    const filter: Record<string, unknown> = {};
    if (key) filter.examKey = key;
    const status = p.get("status");
    if (status) filter.status = status;
    const q = (p.get("q") || "").trim().slice(0, 60);
    if (q) filter.prompt = new RegExp(escapeRegex(q), "i");
    if (/^[a-f\d]{24}$/i.test(p.get("topicId") || "")) filter.topicId = p.get("topicId");
    const [items, total, counts] = await Promise.all([
      Question.find(filter).select("+correctIndex").sort({ createdAt: -1 }).skip((page - 1) * 20).limit(20).lean<Lean[]>(),
      Question.countDocuments(filter),
      Question.aggregate([{ $match: key ? { examKey: key } : {} }, { $group: { _id: "$status", n: { $sum: 1 } } }]),
    ]);
    return NextResponse.json({ items, total, page, counts: Object.fromEntries(counts.map((c) => [c._id ?? "published", c.n])), aiAvailable: aiConfigured() });
  }
  if (view === "templates") return NextResponse.json({ items: await TestTemplate.find(key ? { examKey: key } : {}).sort({ createdAt: -1 }).limit(100).lean() });
  if (view === "dates") return NextResponse.json({ items: await ExamDate.find(key ? { examKey: key } : {}).sort({ date: 1 }).limit(100).lean() });
  if (view === "catalog") return NextResponse.json({ items: await ExamCatalog.find().sort({ title: 1 }).lean() });
  return err("Unknown view", 404);
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await admin();
  if (!user) return err("Super-admin access required", 403);
  if (limited(`prep-admin:${user._id}`, 120)) return err("Please slow down", 429);
  try {
    const body = z.object({ action: z.string().min(1), data: z.unknown().default({}) }).parse(await request.json());
    switch (body.action) {
      case "question-save": {
        const v = z.object({ id: objectId.optional(), examKey, subjectId: objectId.optional(), topicId: objectId.optional(), prompt: z.string(), options: z.array(z.string()), correctIndex: z.number(), explanation: z.string(), difficulty: z.enum(["easy", "medium", "hard"]).default("medium"), source: sourceSchema.default({ name: "", url: "", license: "original", notes: "" }) }).parse(body.data);
        const checked = validateImportRow(v);
        if ("error" in checked) throw new Error(checked.error);
        if (v.topicId && !await SyllabusNode.exists({ _id: v.topicId, examKey: v.examKey, type: "topic" })) throw new Error("Topic does not belong to this exam");
        const hash = contentHash(checked.value.prompt, checked.value.options);
        const dup = await Question.findOne({ examKey: v.examKey, contentHash: hash, ...(v.id ? { _id: { $ne: v.id } } : {}) }).select("_id").lean();
        if (dup) throw new Error("A question with the same text and options already exists");
        const fields = { examKey: v.examKey, subjectId: v.subjectId, topicId: v.topicId, ...checked.value, source: v.source, contentHash: hash };
        if (v.id) {
          const current = await Question.findById(v.id).select("status");
          if (!current) throw new Error("Question not found");
          const record = await Question.findByIdAndUpdate(v.id, { ...fields, ...(current.status === "published" ? { status: "in-review", active: false } : {}) }, { new: true, runValidators: true });
          return NextResponse.json({ ok: true, record, note: current.status === "published" ? "Edited published questions return to review before going live again." : undefined });
        }
        return NextResponse.json({ ok: true, record: await Question.create({ ...fields, status: "draft", active: false, createdBy: user._id }) });
      }
      case "question-status": {
        const v = z.object({ id: objectId, status: z.enum(["draft", "in-review", "published", "archived"]) }).parse(body.data);
        const q = await Question.findById(v.id);
        if (!q) throw new Error("Question not found");
        if (!transitions[q.status ?? "published"]?.includes(v.status)) throw new Error(`Cannot move from ${q.status} to ${v.status}`);
        if (v.status === "published") {
          if (!q.source?.name || q.source.license === "unknown") throw new Error("Add source and copyright details before publishing");
          q.reviewedBy = user._id; q.reviewedAt = new Date(); q.publishedAt = new Date();
        }
        q.status = v.status; q.active = v.status === "published";
        await q.save();
        return NextResponse.json({ ok: true, record: q });
      }
      case "question-import": {
        const v = z.object({ examKey, topicId: objectId.optional(), subjectId: objectId.optional(), source: sourceSchema, rows: z.array(z.unknown()).min(1).max(200), dryRun: z.boolean().default(true) }).parse(body.data);
        if (!v.source.name || v.source.license === "unknown") throw new Error("Imports need a source name and a known license");
        if (v.topicId && !await SyllabusNode.exists({ _id: v.topicId, examKey: v.examKey, type: "topic" })) throw new Error("Topic does not belong to this exam");
        const seen = new Set<string>();
        const report: { row: number; status: "ok" | "duplicate" | "invalid"; error?: string }[] = [];
        const valid: { index: number; value: Record<string, unknown>; hash: string }[] = [];
        v.rows.forEach((row, i) => {
          const checked = validateImportRow((row ?? {}) as Record<string, unknown>);
          if ("error" in checked) return report.push({ row: i + 1, status: "invalid", error: checked.error });
          const hash = contentHash(checked.value.prompt, checked.value.options);
          if (seen.has(hash)) return report.push({ row: i + 1, status: "duplicate", error: "Repeated inside this file" });
          seen.add(hash); valid.push({ index: i, value: checked.value, hash });
        });
        const existing = new Set((await Question.find({ examKey: v.examKey, contentHash: { $in: valid.map((x) => x.hash) } }).select("contentHash").lean<{ contentHash: string }[]>()).map((q) => q.contentHash));
        const fresh = valid.filter((x) => { const dup = existing.has(x.hash); report.push(dup ? { row: x.index + 1, status: "duplicate", error: "Already in the bank" } : { row: x.index + 1, status: "ok" }); return !dup; });
        report.sort((a, b) => a.row - b.row);
        let created = 0;
        if (!v.dryRun && fresh.length) {
          const docs = await Question.insertMany(fresh.map((x) => ({ ...x.value, examKey: v.examKey, topicId: v.topicId, subjectId: v.subjectId, source: v.source, contentHash: x.hash, status: "draft", active: false, createdBy: user._id })), { ordered: false });
          created = docs.length;
        }
        return NextResponse.json({ ok: true, dryRun: v.dryRun, created, summary: { ok: fresh.length, duplicate: report.filter((r) => r.status === "duplicate").length, invalid: report.filter((r) => r.status === "invalid").length }, report });
      }
      case "template-save": {
        const v = z.object({
          id: objectId.optional(), examKey, title: z.string().trim().min(3).max(100), kind: z.enum(["full", "sectional", "topic"]), durationMinutes: z.number().int().min(3).max(360), patternVersion: z.string().trim().max(40).default(""), instructions: z.string().trim().max(800).default(""),
          sections: z.array(z.object({ name: z.string().trim().min(1).max(60), subjectId: objectId.optional(), topicId: objectId.optional(), count: z.number().int().min(1).max(200), marks: z.number().min(0.25).max(10), negative: z.number().min(0).max(10) })).min(1).max(12),
        }).parse(body.data);
        if (v.sections.reduce((s, x) => s + x.count, 0) > 300) throw new Error("A test can have at most 300 questions");
        if (v.sections.some((s) => s.negative > s.marks)) throw new Error("Negative marking cannot exceed the marks for a question");
        const { id, ...fields } = v;
        const record = id ? await TestTemplate.findByIdAndUpdate(id, { ...fields, status: "draft" }, { new: true, runValidators: true }) : await TestTemplate.create({ ...fields, createdBy: user._id });
        if (!record) throw new Error("Template not found");
        return NextResponse.json({ ok: true, record });
      }
      case "template-status": {
        const v = z.object({ id: objectId, status: z.enum(["draft", "published", "archived"]) }).parse(body.data);
        const t = await TestTemplate.findById(v.id);
        if (!t) throw new Error("Template not found");
        if (v.status === "published") {
          const short: string[] = [];
          for (const s of t.sections) {
            const have = await Question.countDocuments(publishedFilter(t.examKey, { ...(s.subjectId ? { subjectId: s.subjectId } : {}), ...(s.topicId ? { topicId: s.topicId } : {}) }));
            if (have < s.count) short.push(`${s.name}: ${have}/${s.count}`);
          }
          if (short.length) throw new Error(`Not enough published questions — ${short.join("; ")}`);
        }
        t.status = v.status; await t.save();
        return NextResponse.json({ ok: true, record: t });
      }
      case "date-save": {
        const v = z.object({ id: objectId.optional(), examKey, title: z.string().trim().min(3).max(120), date: z.iso.datetime(), sourceName: z.string().trim().min(2).max(120), sourceUrl: z.url({ protocol: /^https?$/ }), lastVerifiedAt: z.iso.datetime() }).parse(body.data);
        if (new Date(v.lastVerifiedAt) > new Date()) throw new Error("Verification time cannot be in the future");
        const { id, ...fields } = v;
        const doc = { ...fields, date: new Date(v.date), lastVerifiedAt: new Date(v.lastVerifiedAt) };
        const record = id ? await ExamDate.findByIdAndUpdate(id, doc, { new: true, runValidators: true }) : await ExamDate.create({ ...doc, enteredBy: user._id });
        return NextResponse.json({ ok: true, record });
      }
      case "date-delete": { const v = z.object({ id: objectId }).parse(body.data); await ExamDate.deleteOne({ _id: v.id }); return NextResponse.json({ ok: true }); }
      case "catalog-meta": {
        const v = z.object({ key: examKey, syllabusVersion: z.string().trim().max(40), syllabusSource: z.string().trim().max(300), syllabusVerifiedAt: z.iso.datetime().optional() }).parse(body.data);
        const record = await ExamCatalog.findOneAndUpdate({ key: v.key }, { syllabusVersion: v.syllabusVersion, syllabusSource: v.syllabusSource, syllabusVerifiedAt: v.syllabusVerifiedAt ? new Date(v.syllabusVerifiedAt) : undefined }, { new: true });
        if (!record) throw new Error("Exam not found");
        return NextResponse.json({ ok: true, record });
      }
      case "ai-generate": {
        const v = z.object({ examKey, topicId: objectId, count: z.number().int().min(1).max(5).default(3), difficulty: z.enum(["easy", "medium", "hard"]).default("medium") }).parse(body.data);
        if (limited(`prep-ai-gen:${user._id}`, 4)) throw new Error("AI generation is limited to a few requests per minute");
        const topic = await SyllabusNode.findOne({ _id: v.topicId, examKey: v.examKey, type: "topic" }).lean<{ title: string; parentId?: unknown }>();
        if (!topic) throw new Error("Topic does not belong to this exam");
        const drafts = await draftQuestions({ exam: v.examKey.toUpperCase(), subject: "the syllabus", topic: topic.title, difficulty: v.difficulty, count: v.count });
        if (!drafts) return NextResponse.json({ ok: true, available: false, created: 0, message: "AI is not configured or did not respond. The question bank works without it." });
        let created = 0, rejected = 0;
        for (const d of drafts) {
          if ("error" in d) { rejected++; continue; }
          const hash = contentHash(d.value.prompt, d.value.options);
          if (await Question.exists({ examKey: v.examKey, contentHash: hash })) { rejected++; continue; }
          await Question.create({ ...d.value, examKey: v.examKey, topicId: v.topicId, contentHash: hash, aiGenerated: true, source: { name: "AI draft — unreviewed", license: "ai-generated", url: "", notes: "Verify facts and answer key before publishing" }, status: "draft", active: false, createdBy: user._id });
          created++;
        }
        return NextResponse.json({ ok: true, available: true, created, rejected });
      }
      default: throw new Error("Unsupported action");
    }
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check all fields" : error instanceof Error ? error.message : "Unable to update" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
