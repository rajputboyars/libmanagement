import { NextResponse } from "next/server";

/** Liveness: the process is up. Never touches dependencies, so it is safe for frequent probes. */
export function GET() {
  return NextResponse.json({ status: "ok", uptimeSeconds: Math.round(process.uptime()) }, { headers: { "Cache-Control": "no-store" } });
}
