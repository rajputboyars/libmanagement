import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { currentUser, limited, validOrigin } from "@/lib/auth";
import { PushSubscription } from "@/lib/models";
import { pushPublicKey, pushToUsers } from "@/lib/push";

const err = (message: string, status = 400) => NextResponse.json({ error: message }, { status });
const subscription = z.object({
  endpoint: z.url().max(1000),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

/** Public key for the browser, and whether this user already has a phone registered. */
export async function GET() {
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  const count = await PushSubscription.countDocuments({ userId: user._id });
  return NextResponse.json({ publicKey: pushPublicKey(), devices: count });
}

export async function POST(request: NextRequest) {
  if (!validOrigin(request)) return err("Invalid origin", 403);
  const user = await currentUser();
  if (!user) return err("Sign in required", 401);
  if (limited(`push:${user._id}`, 20)) return err("Please slow down", 429);
  try {
    const body = await request.json();
    const action = z.enum(["subscribe", "unsubscribe", "test"]).parse(body.action);
    if (action === "test") {
      const sent = await pushToUsers([user._id], { title: "StudyQuest", body: "Phone notifications are working.", url: "/" });
      if (!sent) return err("No phone received it. Turn notifications on again.");
      return NextResponse.json({ ok: true, sent });
    }
    const sub = subscription.parse(body.data);
    if (action === "unsubscribe") {
      await PushSubscription.deleteOne({ endpoint: sub.endpoint, userId: user._id });
      return NextResponse.json({ ok: true });
    }
    if (!pushPublicKey()) return err("Phone notifications are not set up on this server yet");
    // One endpoint belongs to one browser; if someone else signed in on it before, it moves to this user.
    await PushSubscription.findOneAndUpdate(
      { endpoint: sub.endpoint },
      { $set: { userId: user._id, keys: sub.keys, userAgent: (request.headers.get("user-agent") || "").slice(0, 200) } },
      { upsert: true },
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof z.ZodError) return err("That subscription is not valid");
    return err(e instanceof Error ? e.message : "Could not save");
  }
}
