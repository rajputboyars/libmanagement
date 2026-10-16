import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { canTransition, seatShouldBeOffline, sortByUrgency } from "../src/lib/maintenance";

describe("Maintenance rules", () => {
  it("allows only valid status transitions", () => {
    assert.equal(canTransition("open", "assigned"), true);
    assert.equal(canTransition("resolved", "in-progress"), true);
    assert.equal(canTransition("resolved", "assigned"), false);
    assert.equal(canTransition("cancelled", "open"), false);
  });
  it("keeps a seat offline only while an active offline issue exists", () => {
    assert.equal(seatShouldBeOffline([{ status: "open", seatOffline: true }]), true);
    assert.equal(seatShouldBeOffline([{ status: "resolved", seatOffline: true }, { status: "open", seatOffline: false }]), false);
    assert.equal(seatShouldBeOffline([{ status: "resolved", seatOffline: true }, { status: "in-progress", seatOffline: true }]), true);
    assert.equal(seatShouldBeOffline([]), false);
  });
  it("sorts by priority then age", () => {
    const sorted = sortByUrgency([
      { priority: "low" as const, createdAt: "2026-01-01" },
      { priority: "urgent" as const, createdAt: "2026-02-01" },
      { priority: "urgent" as const, createdAt: "2026-01-15" },
    ]);
    assert.deepEqual(sorted.map((i) => i.createdAt), ["2026-01-15", "2026-02-01", "2026-01-01"]);
  });
});
