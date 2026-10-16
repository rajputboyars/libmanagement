import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Restore drill against disposable databases on a throwaway replica set. Never touches application data.
const enabled = !!process.env.TEST_MONGODB_URI;
const withDb = (uri: string, name: string) => uri.replace(/\/(\?|$)/, `/${name}$1`);

test("backup → verify → restore into a separate database keeps payments, memberships and XP history intact", { skip: !enabled }, async () => {
  const mongoose = (await import("mongoose")).default;
  const { backupDatabase, restoreDatabase, verifyBackup } = await import("../src/lib/backup");
  const base = process.env.TEST_MONGODB_URI!;
  const sourceUri = withDb(base, "drill_source"), targetUri = withDb(base, "drill_restore"), nonEmptyUri = withDb(base, "drill_nonempty");
  const src = await mongoose.createConnection(sourceUri).asPromise();
  const libraryId = new mongoose.Types.ObjectId(), userId = new mongoose.Types.ObjectId(), membershipId = new mongoose.Types.ObjectId();
  await src.collection("memberships").insertOne({ _id: membershipId, libraryId, userId, amount: 120000, paid: 50000, start: new Date("2026-10-01T00:00:00Z"), status: "active" });
  await src.collection("payments").insertMany([{ libraryId, membershipId, key: "k1", amount: 30000, method: "cash", receipt: "R-1" }, { libraryId, membershipId, key: "k2", amount: 20000, method: "upi", receipt: "R-2" }]);
  await src.collection("payments").createIndex({ libraryId: 1, key: 1 }, { unique: true });
  await src.collection("xptransactions").insertMany(Array.from({ length: 1200 }, (_, i) => ({ userId, source: `s${i}`, amount: 5, day: "2026-10-16" }))); // forces multiple batches
  const dir = mkdtempSync(join(tmpdir(), "sq-backup-"));
  const manifest = await backupDatabase(sourceUri, dir);
  assert.deepEqual(Object.fromEntries(manifest.collections.map((c) => [c.name, c.count])), { memberships: 1, payments: 2, xptransactions: 1200 });
  assert.equal((await verifyBackup(dir)).problems.length, 0);

  const result = await restoreDatabase(dir, targetUri);
  assert.equal(result.ok, true);
  const dst = await mongoose.createConnection(targetUri).asPromise();
  const m = await dst.collection("memberships").findOne({ _id: membershipId });
  assert.ok(m && m.libraryId.equals(libraryId) && m.start instanceof Date && m.paid === 50000, "ObjectIds and dates survive exactly");
  const sum = await dst.collection("payments").aggregate([{ $group: { _id: null, t: { $sum: "$amount" } } }]).toArray();
  assert.equal(sum[0].t, m!.paid, "payment history reconciles with the membership after restore");
  assert.equal(await dst.collection("xptransactions").countDocuments(), 1200);
  await assert.rejects(dst.collection("payments").insertOne({ libraryId, membershipId, key: "k1", amount: 1, method: "cash" }), /duplicate key/i, "unique indexes are rebuilt");

  // Safety rails: non-empty target refused, tampered backup refused.
  await src.collection("memberships").aggregate([{ $match: {} }, { $out: { db: "drill_nonempty", coll: "memberships" } }]).toArray();
  await assert.rejects(restoreDatabase(dir, nonEmptyUri), /not empty/);
  const files = readdirSync(dir).filter((f) => f.endsWith(".gz"));
  appendFileSync(join(dir, files[0]), "tamper");
  assert.ok((await verifyBackup(dir)).problems.some((p) => /checksum mismatch/.test(p)));
  await assert.rejects(restoreDatabase(dir, withDb(base, "drill_tampered")), /failed verification/);

  for (const conn of [src, dst]) { await conn.dropDatabase(); await conn.close(); }
  const extra = await mongoose.createConnection(nonEmptyUri).asPromise(); await extra.dropDatabase(); await extra.close();
});
