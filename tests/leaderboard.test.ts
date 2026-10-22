import { test } from "node:test";
import assert from "node:assert/strict";
import { rankBoard, weekStart } from "../src/lib/leaderboard";

test("week starts Monday 00:00 India time", () => {
  // Wed 22 Oct 2026, 10:00 UTC → Monday 19 Oct 00:00 IST = Sunday 18 Oct 18:30 UTC
  assert.equal(weekStart(new Date("2026-10-22T10:00:00Z")).toISOString(), "2026-10-18T18:30:00.000Z");
  // Sunday 25 Oct 20:00 UTC is already Monday 26 Oct in India → new week
  assert.equal(weekStart(new Date("2026-10-25T20:00:00Z")).toISOString(), "2026-10-25T18:30:00.000Z");
});

test("ranks share ties and include my row outside the top", () => {
  const rows = [
    { userId: "a", name: "Asha", minutes: 300 },
    { userId: "b", name: "Bina", minutes: 300 },
    { userId: "c", name: "Chetan", minutes: 120 },
    { userId: "d", name: "Dev", minutes: 10 },
  ];
  const r = rankBoard(rows, "d", 2);
  assert.deepEqual(r.top.map((x) => [x.name, x.rank]), [["Asha", 1], ["Bina", 1]]);
  assert.equal(r.mine?.rank, 4);
  assert.equal(r.players, 4);
});
