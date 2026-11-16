import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

/** Liveness: the process is up and can serve a request. Never touches MongoDB or any other dependency, so it is safe for frequent probes. */
export function GET() {
  return NextResponse.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }, { headers });
}
export function HEAD() {
  return new NextResponse(null, { status: 200, headers });
}
