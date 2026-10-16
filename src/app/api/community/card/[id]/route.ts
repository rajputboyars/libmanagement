import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { CommunityProfile, SuccessPost } from "@/lib/models";
import { headline, xml, type MilestoneType } from "@/lib/community";
import { canViewPost, type PostDoc, type ProfileDoc } from "@/lib/community-server";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user || !/^[a-f\d]{24}$/i.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const post = await SuccessPost.findById(id).lean<PostDoc>();
  if (!post || (post.status === "removed" && String(post.userId) !== String(user._id)) || !(await canViewPost(post, user))) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const author = await CommunityProfile.findOne({ userId: post.userId }).select("alias").lean<ProfileDoc>();
  const lines = xml(headline(post.milestoneType as MilestoneType, post.milestoneValue));
  const message = xml(post.message || "");
  const date = new Date(post.createdAt as Date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080" role="img" aria-label="${lines}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#20745b"/><stop offset="1" stop-color="#243e35"/></linearGradient></defs>
<rect width="1080" height="1080" rx="64" fill="url(#g)"/>
<circle cx="900" cy="180" r="260" fill="#ffffff" opacity=".07"/><circle cx="160" cy="940" r="320" fill="#ffffff" opacity=".06"/>
<text x="90" y="170" fill="#cfe8dc" font-family="Georgia,serif" font-size="40" letter-spacing="6">STUDYQUEST</text>
<text x="90" y="520" fill="#fff" font-family="Georgia,serif" font-size="88" font-weight="700">${lines}</text>
<text x="90" y="620" fill="#cfe8dc" font-family="Arial,sans-serif" font-size="40">${message}</text>
<text x="90" y="940" fill="#fff" font-family="Arial,sans-serif" font-size="44" font-weight="700">${xml(author?.alias || "Student")}</text>
<text x="90" y="995" fill="#cfe8dc" font-family="Arial,sans-serif" font-size="32">Verified on ${xml(date)}</text>
</svg>`;
  return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Content-Disposition": `inline; filename="studyquest-card.svg"` } });
}
