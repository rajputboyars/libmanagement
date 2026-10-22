import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { StudentProfile, StudySession, User } from "@/lib/models";
import { containsContactInfo } from "@/lib/community";
import { rankBoard, weekStart } from "@/lib/leaderboard";

const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });

export async function GET() {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("The leaderboard is for students", 403);
  const mine = await StudentProfile.findOne({ userId: user._id }).select("leaderboard leaderboardName").lean<{ leaderboard?: boolean; leaderboardName?: string }>();
  const base = { joined: !!mine?.leaderboard, name: mine?.leaderboardName || user.name.split(" ")[0], hasLibrary: !!user.libraryId };
  if (!user.libraryId) return NextResponse.json({ ...base, top: [], mine: null, players: 0, since: weekStart() });
  const since = weekStart();
  const classmates = await User.find({ libraryId: user.libraryId, role: "student", deletedAt: { $exists: false } }).select("_id").lean<{ _id: unknown }[]>();
  const players = await StudentProfile.find({ userId: { $in: classmates.map((c) => c._id) }, leaderboard: true })
    .select("userId leaderboardName")
    .lean<{ userId: unknown; leaderboardName?: string }[]>();
  const totals = await StudySession.aggregate<{ _id: unknown; seconds: number }>([
    { $match: { userId: { $in: players.map((p) => p.userId) }, state: "complete", completedAt: { $gte: since } } },
    { $group: { _id: "$userId", seconds: { $sum: "$activeSeconds" } } },
  ]);
  const secondsBy = new Map(totals.map((t) => [String(t._id), t.seconds]));
  const board = rankBoard(
    players.map((p) => ({ userId: String(p.userId), name: p.leaderboardName || "Student", minutes: Math.round((secondsBy.get(String(p.userId)) ?? 0) / 60) })),
    String(user._id),
  );
  // Never send other students' user ids to the browser.
  const strip = (r: (typeof board.top)[number]) => ({ rank: r.rank, name: r.name, minutes: r.minutes, me: r.me });
  return NextResponse.json({ ...base, since, players: board.players, top: board.top.map(strip), mine: board.mine ? strip(board.mine) : null });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (user.role !== "student") return err("The leaderboard is for students", 403);
  if (limited(`leaderboard:${user._id}`, 20)) return err("Please slow down", 429);
  try {
    const v = z.object({ join: z.boolean(), name: z.string().trim().min(2, "Use at least 2 characters").max(24).optional() }).parse((await request.json()).data);
    if (v.join && !v.name) throw new Error("Choose a display name");
    if (v.name && containsContactInfo(v.name)) throw new Error("Don't put a phone number, email or link in your name");
    await StudentProfile.updateOne(
      { userId: user._id },
      { $set: { leaderboard: v.join, ...(v.name ? { leaderboardName: v.name } : {}) }, $setOnInsert: { libraryId: user.libraryId } },
      { upsert: true },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err(e.issues[0]?.message ?? "Invalid name");
    return err(e instanceof Error ? e.message : "Could not save");
  }
}
