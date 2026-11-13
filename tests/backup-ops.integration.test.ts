import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

// Encrypted backup -> check -> verified restore against disposable databases on a throwaway replica set.
const enabled = !!process.env.TEST_MONGODB_URI;
const withDb = (uri: string, name: string) => uri.replace(/\/(\?|$)/, `/${name}$1`);

test("encrypted backup, health checks and verified restore keep every tenant's data separate and intact", { skip: !enabled }, async () => {
  const mongoose = (await import("mongoose")).default;
  const { parseKeyRing } = await import("../src/lib/backup-crypto");
  const { DirStore } = await import("../src/lib/backup-store");
  const { runBackup, checkBackups, restoreFromStore } = await import("../src/lib/backup-ops");
  const { verifyRestored, verifyBackup } = await import("../src/lib/backup");
  const base = process.env.TEST_MONGODB_URI!;
  const sourceUri = withDb(base, "ops_source"), targetUri = withDb(base, "ops_restore"), dirtyUri = withDb(base, "ops_dirty"), cleanUri = withDb(base, "ops_clean");
  const root = mkdtempSync(join(tmpdir(), "sq-ops-"));
  process.env.BACKUP_TMP_DIR = join(root, "work");
  (await import("node:fs")).mkdirSync(process.env.BACKUP_TMP_DIR, { recursive: true });
  const store = new DirStore(join(root, "offsite"));
  const ring = parseKeyRing(`k1:${randomBytes(32).toString("base64")}`);
  const oid = () => new mongoose.Types.ObjectId();

  // Two tenants with real relationships.
  const src = await mongoose.createConnection(sourceUri).asPromise();
  const [ownerA, ownerB, studentA, studentB] = [oid(), oid(), oid(), oid()];
  const [libA, libB] = [oid(), oid()];
  const [memA, memB] = [oid(), oid()];
  const [seatA, seatB] = [oid(), oid()];
  await src.collection("users").insertMany([{ _id: ownerA, name: "Owner A", email: "a@x.invalid", libraryId: libA }, { _id: ownerB, name: "Owner B", email: "b@x.invalid", libraryId: libB }, { _id: studentA, name: "Student A", libraryId: libA }, { _id: studentB, name: "Student B", libraryId: libB }]);
  await src.collection("libraries").insertMany([{ _id: libA, name: "Library A", ownerId: ownerA }, { _id: libB, name: "Library B", ownerId: ownerB }]);
  await src.collection("seats").insertMany([{ _id: seatA, libraryId: libA, label: "A1" }, { _id: seatB, libraryId: libB, label: "B1" }]);
  await src.collection("memberships").insertMany([{ _id: memA, libraryId: libA, userId: studentA, paid: 30000 }, { _id: memB, libraryId: libB, userId: studentB, paid: 50000 }]);
  await src.collection("seatassignments").insertMany([{ libraryId: libA, seatId: seatA, userId: studentA, membershipId: memA }, { libraryId: libB, seatId: seatB, userId: studentB, membershipId: memB }]);
  await src.collection("payments").insertMany([{ libraryId: libA, membershipId: memA, key: "k1", amount: 30000 }, { libraryId: libB, membershipId: memB, key: "k1", amount: 50000 }]);
  await src.collection("payments").createIndex({ libraryId: 1, key: 1 }, { unique: true });
  await src.collection("passwordresets").insertOne({ userId: studentA, tokenHash: "h", expiresAt: new Date(Date.now() + 2 * 86400_000) });
  await src.collection("passwordresets").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index: restored last so it cannot purge documents mid-verification
  await src.collection("xptransactions").insertMany(Array.from({ length: 700 }, (_, i) => ({ libraryId: i % 2 ? libA : libB, userId: i % 2 ? studentA : studentB, source: `s${i}`, amount: 1 })));

  // 1) backup: encrypted, uploaded, sidecar written, plaintext workspace wiped
  const result = await runBackup({ uri: sourceUri, store, ring, now: new Date() });
  assert.equal(result.sidecar.documents, 4 + 2 + 2 + 2 + 2 + 2 + 1 + 700);
  assert.equal(readdirSync(process.env.BACKUP_TMP_DIR).length, 0, "no plaintext working files remain");
  const stored = readdirSync(join(root, "offsite"));
  assert.deepEqual(stored.sort(), [result.name, `${result.name}.json`].sort());
  const bytes = (await import("node:fs")).readFileSync(join(root, "offsite", result.name));
  assert.ok(!bytes.includes("Owner A") && !bytes.includes("a@x.invalid"), "customer data is not readable in the stored archive");
  assert.ok(!(await import("node:fs")).readFileSync(join(root, "offsite", `${result.name}.json`), "utf8").includes("a@x.invalid"), "the sidecar holds counts only");

  // 2) health check passes, deep check decrypts and verifies checksums
  const health = await checkBackups({ store, deep: { ring } });
  assert.equal(health.ok, true, JSON.stringify(health));
  assert.equal(health.deep?.verified, true);

  // 3) dry run restores nothing; real restore needs the exact confirmation and a safe target
  const dry = await restoreFromStore({ store, ring, targetUri, environment: "drill", protectedUris: [sourceUri] });
  assert.equal(dry.ok, true); assert.equal(dry.dryRun, true);
  const probe = await mongoose.createConnection(targetUri).asPromise();
  assert.equal((await probe.db!.listCollections().toArray()).length, 0, "dry run leaves the target empty");
  const wrongConfirm = await restoreFromStore({ store, ring, targetUri, environment: "drill", confirm: "ops_source@wrong", protectedUris: [sourceUri] });
  assert.equal(wrongConfirm.dryRun, true, "a mismatching confirmation is treated as a dry run");
  assert.equal((await probe.db!.listCollections().toArray()).length, 0);

  const target = new URL(targetUri.replace("mongodb://", "http://")).host;
  const done = await restoreFromStore({ store, ring, targetUri, environment: "drill", confirm: `ops_restore@${target}`, protectedUris: [sourceUri] });
  assert.equal(done.ok, true, JSON.stringify(done));
  assert.equal(done.dryRun, false);
  assert.equal(done.documents, result.sidecar.documents);
  assert.ok(done.steps.some((s) => s.step === "verify-restored"), "verification ran after the restore");
  assert.ok(done.steps.some((s) => s.step === "ttl-indexes"), "TTL indexes are created after verification");
  assert.ok((await probe.collection("passwordresets").indexes()).some((i) => i.expireAfterSeconds === 0), "the TTL index exists on the restored collection");
  const aPayments = await probe.collection("payments").find({ libraryId: libA }).toArray();
  assert.deepEqual(aPayments.map((p) => p.amount), [30000], "tenant A keeps exactly its own payment");
  assert.equal(await probe.collection("xptransactions").countDocuments({ libraryId: libB }), 350);

  // 4) the verifier catches damage: lost rows, a payment moved to another tenant, a dropped index
  const sideData = await (async () => { const { unpackDir, decryptFile } = await import("../src/lib/backup-crypto"); const w = join(root, "m"); await decryptFile(join(root, "offsite", result.name), join(w + ".bin"), ring); await unpackDir(join(w + ".bin"), w); return (await verifyBackup(w)).manifest; })();
  assert.equal((await verifyRestored(sideData, targetUri)).ok, true);
  await probe.collection("xptransactions").deleteOne({});
  await probe.collection("payments").updateOne({ libraryId: libA }, { $set: { membershipId: memB } }); // tenant A payment now points at tenant B's membership
  await probe.collection("payments").dropIndex("libraryId_1_key_1");
  const damaged = await verifyRestored(sideData, targetUri);
  assert.equal(damaged.ok, false);
  const text = damaged.problems.join(" | ");
  assert.match(text, /xptransactions: expected 700 documents, found 699/);
  assert.match(text, /library .* has \d+ documents, backup had/);
  assert.match(text, /relationship changed: payments\.membershipId -> memberships \(same library\)/);
  assert.match(text, /payments: index libraryId_1_key_1 missing/);

  // 5) wrong targets and unsafe situations
  await assert.rejects(restoreFromStore({ store, ring, targetUri: sourceUri, environment: "staging", confirm: `ops_source@${target}`, protectedUris: [sourceUri] }), /protected \(live\)/);
  await assert.rejects(restoreFromStore({ store, ring, targetUri: base, environment: "staging" }), /explicit database/);
  await assert.rejects(restoreFromStore({ store, ring, targetUri, environment: "prod" }), /--environment/);
  const nonEmpty = await restoreFromStore({ store, ring, targetUri, environment: "drill", confirm: `ops_restore@${target}`, protectedUris: [sourceUri] });
  assert.equal(nonEmpty.ok, false); assert.match(nonEmpty.problems.join(), /not empty/, "a populated target is never overwritten");
  assert.equal(await probe.collection("payments").countDocuments(), 2, "target untouched by the refused restore");

  // wrong key / tampered archive never reach the database
  const wrongKey = await restoreFromStore({ store, ring: parseKeyRing(`k1:${randomBytes(32).toString("base64")}`), targetUri: dirtyUri, environment: "qa", confirm: `ops_dirty@${target}`, protectedUris: [sourceUri] });
  assert.equal(wrongKey.ok, false); assert.match(wrongKey.problems.join(), /authentication/);
  appendFileSync(join(root, "offsite", result.name), "tamper");
  const tampered = await restoreFromStore({ store, ring, targetUri: dirtyUri, environment: "qa", confirm: `ops_dirty@${target}`, protectedUris: [sourceUri] });
  assert.equal(tampered.ok, false);
  const dirty = await mongoose.createConnection(dirtyUri).asPromise();
  assert.equal((await dirty.db!.listCollections().toArray()).length, 0, "nothing was written for an unauthenticated archive");
  const bad = await checkBackups({ store, deep: { ring } });
  assert.equal(bad.ok, false, "the health check flags the corrupted archive");
  assert.match(bad.problems.join(), /does not match the recorded|deep verification failed/);
  assert.equal(readdirSync(process.env.BACKUP_TMP_DIR).length, 0, "restore and check clean up their plaintext");

  // 6) backup failures are loud and leave no plaintext behind
  await assert.rejects(runBackup({ uri: "mongodb://user:hunter2@127.0.0.1:1/nope?serverSelectionTimeoutMS=1200&connectTimeoutMS=1200", store, ring }), (e: Error) => /Database dump failed/.test(e.message) && !/hunter2/.test(e.message));
  const emptyConn = await mongoose.createConnection(cleanUri).asPromise();
  await emptyConn.collection("tmp").insertOne({ a: 1 }); await emptyConn.collection("tmp").deleteOne({}); // collection exists but has no documents
  await assert.rejects(runBackup({ uri: cleanUri, store, ring }), /empty backup/);
  const failingStore = Object.assign(Object.create(Object.getPrototypeOf(store)), store, { put: async () => { throw new Error("storage unavailable"); } });
  await assert.rejects(runBackup({ uri: sourceUri, store: failingStore, ring }), /storage unavailable/);
  const lyingStore = Object.assign(Object.create(Object.getPrototypeOf(store)), store, { list: async () => [] });
  await assert.rejects(runBackup({ uri: sourceUri, store: lyingStore, ring, now: new Date(Date.now() + 1000) }), /Upload verification failed/);
  assert.equal(readdirSync(process.env.BACKUP_TMP_DIR).length, 0, "failed backups wipe their plaintext workspace");

  for (const c of [src, probe, dirty, emptyConn]) { await c.dropDatabase(); await c.close(); }
  rmSync(root, { recursive: true, force: true });
});
