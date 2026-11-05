import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { currentUser, secret } from "@/lib/auth";
import { signAttendanceToken } from "@/lib/attendance-token";
import { PlanError, requireFeature } from "@/lib/saas-server";
export async function GET(req: NextRequest) {
  const user = await currentUser();
  if (!user || user.role !== "owner" || !user.libraryId)
    return NextResponse.json(
      { error: "Owner permission required" },
      { status: 403 },
    );
  try {
    await requireFeature(user.libraryId, "qr-attendance", "QR attendance");
  } catch (error) {
    if (error instanceof PlanError) return NextResponse.json({ error: error.message, code: error.code }, { status: 402 });
    throw error;
  }
  const token = await signAttendanceToken(String(user.libraryId), secret());
  const base =
    process.env.APP_URL ||
    `${new URL(req.url).protocol}//${req.headers.get("host")}`;
  const svg = await QRCode.toString(`${base}/app/check-in?token=${token}`, {
    type: "svg",
    margin: 2,
    color: { dark: "#243e35", light: "#ffffff" },
  });
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "private, no-store",
    },
  });
}
