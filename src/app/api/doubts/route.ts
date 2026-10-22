import { studentFeatureBlocked } from "@/lib/student-access-server";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { AIUsage, Doubt } from "@/lib/models";
import { solveDoubt, validateImageData } from "@/lib/ai-provider";

export async function GET(request: NextRequest) {
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "doubts"); if (blocked) return blocked; }
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "student") return NextResponse.json({ error: "Student access required" }, { status: 403 });
  const page = Math.max(1, Number(request.nextUrl.searchParams.get("page") || 1));
  const limit = 12;
  const [items, total, usage] = await Promise.all([
    Doubt.find({ userId: user._id }).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Doubt.countDocuments({ userId: user._id }),
    AIUsage.findOne({ userId: user._id, day: new Date().toISOString().slice(0, 10) }).lean(),
  ]);
  const usageRecord = usage as null | { requests?: number };
  return NextResponse.json({ items, page, pages: Math.max(1, Math.ceil(total / limit)), usage: usageRecord?.requests || 0, limit: 10, provider: process.env.STUDYQUEST_AI_PROVIDER === "ollama" ? "ollama" : "fallback" });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
  const user = await currentUser();
  { const blocked = await studentFeatureBlocked(user, "doubts"); if (blocked) return blocked; }
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  if (user.role !== "student") return NextResponse.json({ error: "Student access required" }, { status: 403 });
  if (limited(`doubt:${user._id}`, 12)) return NextResponse.json({ error: "Please slow down" }, { status: 429 });
  try {
    const value = z.object({
      question: z.string().trim().max(3000).default(""),
      subject: z.string().trim().min(2).max(60),
      difficulty: z.enum(["foundation", "standard", "advanced"]),
      imageDataUrl: z.string().max(2_900_000).optional(),
    }).refine((item) => item.question.length >= 5 || Boolean(item.imageDataUrl), "Add a question or an image").parse(await request.json());
    const day = new Date().toISOString().slice(0, 10);
    const usage = await AIUsage.findOneAndUpdate(
      { userId: user._id, day, requests: { $lt: 10 } },
      { $inc: { requests: 1 } },
      { upsert: true, new: true, runValidators: true },
    ).catch(() => null);
    if (!usage) return NextResponse.json({ error: "Daily doubt limit reached. Try again tomorrow." }, { status: 429 });
    const image = validateImageData(value.imageDataUrl);
    const answer = await solveDoubt({ question: value.question, subject: value.subject, difficulty: value.difficulty, imageBase64: image?.base64 });
    if (answer.provider === "ollama") await AIUsage.updateOne({ _id: usage._id }, { $inc: { providerRequests: 1 } });
    const record = await Doubt.create({
      userId: user._id, subject: value.subject, difficulty: value.difficulty, question: value.question,
      ...(image ? { image: { mime: image.mime, data: image.buffer, size: image.buffer.length } } : {}),
      ...answer,
    });
    return NextResponse.json({ ok: true, record: record.toObject() });
  } catch (error) {
    return NextResponse.json({ error: error instanceof z.ZodError ? error.issues[0]?.message || "Check the question" : error instanceof Error ? error.message : "Unable to solve this doubt" }, { status: error instanceof z.ZodError ? 422 : 400 });
  }
}
