import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isStaleOffer, offerExpiry, queuePosition } from "../src/lib/waitlist";

describe("Seat waitlist rules", () => {
  const now = new Date("2026-10-16T12:00:00.000Z");
  it("offers last exactly 24 hours", () => {
    assert.equal(offerExpiry(now).toISOString(), "2026-10-17T12:00:00.000Z");
  });
  it("marks only lapsed offered/accepted entries stale", () => {
    assert.equal(isStaleOffer({ status: "offered", offerExpiresAt: "2026-10-16T11:59:59.000Z" }, now), true);
    assert.equal(isStaleOffer({ status: "accepted", offerExpiresAt: now }, now), true);
    assert.equal(isStaleOffer({ status: "offered", offerExpiresAt: "2026-10-16T12:00:01.000Z" }, now), false);
    assert.equal(isStaleOffer({ status: "waiting" }, now), false);
    assert.equal(isStaleOffer({ status: "confirmed", offerExpiresAt: "2020-01-01" }, now), false);
  });
  it("orders waiting entries by join time and ignores others", () => {
    const entries = [
      { id: "b", status: "waiting", createdAt: "2026-10-02" },
      { id: "x", status: "offered", createdAt: "2026-10-01" },
      { id: "a", status: "waiting", createdAt: "2026-10-01" },
    ];
    assert.equal(queuePosition(entries, "a"), 1);
    assert.equal(queuePosition(entries, "b"), 2);
    assert.equal(queuePosition(entries, "x"), null);
  });
});
