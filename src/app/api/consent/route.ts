import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { reportUnexpected } from "@/lib/api-errors";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { consentStatus, recordConsent } from "@/lib/consent";
import { db } from "@/lib/db";

const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** The signed-in person's OWN consent state. There is no user parameter: nobody can read anyone else's records through this route. */
export async function GET() {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  await db();
  return NextResponse.json(await consentStatus(user._id), { headers: { "Cache-Control": "no-store" } });
}

/**
 * accept-terms: records acceptance of the CURRENT Terms and Privacy Notice (for people who registered before they existed or before a new version).
 * marketing: separate, optional, can be switched on and off at any time. Neither is ever inferred from the other.
 */
export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`consent:${user._id}`, 20)) return err("Please slow down", 429);
  try {
    const body = z.discriminatedUnion("action", [
      z.object({ action: z.literal("accept-terms"), accept: z.literal(true) }),
      z.object({ action: z.literal("marketing"), value: z.boolean() }),
    ]).parse(await request.json());
    await db();
    if (body.action === "accept-terms") await recordConsent(user._id, [{ kind: "terms", accepted: true }], "prompt");
    else await recordConsent(user._id, [{ kind: "marketing", accepted: body.value }], "settings");
    return NextResponse.json({ ok: true, ...(await consentStatus(user._id)) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    reportUnexpected(error, "/api/consent");
    return err(error instanceof z.ZodError ? "Unsupported request" : "Unable to save your choice");
  }
}
