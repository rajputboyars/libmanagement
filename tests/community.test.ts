import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buddyScore, containsContactInfo, earnedRungs, headline, pairKey, xml } from "../src/lib/community";
import { mayInteract } from "../src/lib/community-server";

describe("Community safety rules", () => {
  it("blocks contact details in free text", () => {
    for (const bad of ["mail me a@b.co", "call 98765 43210", "see www.x.in", "https://x.y/z", "dm @someone", "find me on Instagram", "visit foo.com"]) assert.equal(containsContactInfo(bad), true, bad);
    for (const ok of ["Finish quant by December", "Solve 20 papers", "Revise 5 chapters"]) assert.equal(containsContactInfo(ok), false, ok);
  });
  it("only lets opted-in, active, consented members interact", () => {
    assert.equal(mayInteract({ optedIn: true, moderation: "active", consentStatus: "not-required" }), true);
    assert.equal(mayInteract({ optedIn: true, moderation: "active", consentStatus: "approved" }), true);
    assert.equal(mayInteract({ optedIn: true, moderation: "active", consentStatus: "pending" }), false);
    assert.equal(mayInteract({ optedIn: true, moderation: "suspended", consentStatus: "not-required" }), false);
    assert.equal(mayInteract({ optedIn: false, moderation: "active", consentStatus: "not-required" }), false);
    assert.equal(mayInteract(null), false);
  });
  it("derives milestone rungs only from verified values", () => {
    assert.deepEqual(earnedRungs("focus-hours", 26), [5, 10, 25]);
    assert.deepEqual(earnedRungs("streak", 2), []);
    assert.equal(headline("level", 5), "Reached level 5");
  });
  it("builds stable pair keys and deterministic buddy scores", () => {
    assert.equal(pairKey("buddy", "b", "a"), pairKey("buddy", "a", "b"));
    assert.notEqual(pairKey("mentorship", "a", "b"), pairKey("mentorship", "b", "a"));
    const close = buddyScore({ weeklyMinutes: 600 }, { userId: "x", examKey: "ssc", weeklyMinutes: 600, sharedSubjects: 2 });
    const far = buddyScore({ weeklyMinutes: 600 }, { userId: "y", examKey: "ssc", weeklyMinutes: 120, sharedSubjects: 0 });
    assert.ok(close > far);
  });
  it("escapes markup in generated cards", () => {
    assert.equal(xml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});

it("buddy score prefers students in the same shift", () => {
  const base = { userId: "x", examKey: "ssc", weeklyMinutes: 600, sharedSubjects: 1 };
  assert.equal(buddyScore({ weeklyMinutes: 600 }, { ...base, sameShift: true }) - buddyScore({ weeklyMinutes: 600 }, base), 25);
});
