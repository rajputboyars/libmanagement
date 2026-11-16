import assert from "node:assert/strict";
import test from "node:test";
import { createServer, type Server } from "node:http";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { decryptFile, encryptFile, packDir, parseKeyRing, unpackDir } from "../src/lib/backup-crypto";
import { DirStore, S3Store, storeFromEnv } from "../src/lib/backup-store";
import { assertSafeRestoreTarget, checkBackups, pruneBackups, selectRetention } from "../src/lib/backup-ops";
import { scrubSecrets, targetFingerprint } from "../src/lib/backup";

const tmp = () => mkdtempSync(join(tmpdir(), "sq-bk-test-"));
const keyOf = (id: string) => `${id}:${randomBytes(32).toString("base64")}`;
const ago = (h: number, now = new Date("2026-11-14T12:00:00Z")) => new Date(now.getTime() - h * 3600_000);
const stampName = (d: Date, db = "studyquest") => `studyquest-${db}-${d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}.sqbak`;

test("key ring: parses, first key is active, rejects bad keys", () => {
  const a = keyOf("k1"), b = keyOf("k2");
  const ring = parseKeyRing(`${a},${b}`);
  assert.equal(ring.active.id, "k1");
  assert.equal(ring.byId.size, 2);
  assert.throws(() => parseKeyRing(undefined), /not set/);
  assert.throws(() => parseKeyRing("k1:c2hvcnQ="), /32 bytes/);
  assert.throws(() => parseKeyRing(`${a},${a}`), /Duplicate/);
  assert.throws(() => parseKeyRing("nocolon"), /id:base64key/);
});

test("encrypt/decrypt round-trips; wrong key, tampering, truncation and header edits are rejected", async () => {
  const dir = tmp();
  try {
    const ring = parseKeyRing(keyOf("k1"));
    const plain = join(dir, "p"), enc = join(dir, "e"), out = join(dir, "o");
    const secretText = "customer-phone-9876543210 " + "x".repeat(300000);
    writeFileSync(plain, secretText);
    const meta = await encryptFile(plain, enc, ring);
    assert.equal(meta.keyId, "k1");
    assert.ok(!readFileSync(enc).includes("customer-phone"), "ciphertext holds no plaintext");
    await decryptFile(enc, out, ring);
    assert.equal(readFileSync(out, "utf8"), secretText);
    // wrong key with the same id, and unknown key id
    await assert.rejects(decryptFile(enc, join(dir, "o2"), parseKeyRing(keyOf("k1"))), /authentication/);
    assert.equal(readdirSync(dir).includes("o2"), false, "no plaintext is left behind on failure");
    await assert.rejects(decryptFile(enc, join(dir, "o3"), parseKeyRing(keyOf("zz"))), /No key "k1"/);
    // flipped ciphertext byte
    const raw = readFileSync(enc); raw[40] ^= 1; writeFileSync(join(dir, "flip"), raw);
    await assert.rejects(decryptFile(join(dir, "flip"), join(dir, "o4"), ring), /authentication/);
    // appended garbage / truncation
    writeFileSync(join(dir, "app"), readFileSync(enc)); appendFileSync(join(dir, "app"), "x");
    await assert.rejects(decryptFile(join(dir, "app"), join(dir, "o5"), ring), /authentication/);
    writeFileSync(join(dir, "trunc"), readFileSync(enc)); truncateSync(join(dir, "trunc"), 20);
    await assert.rejects(decryptFile(join(dir, "trunc"), join(dir, "o6"), ring), /truncated|header/);
    // header (key id) swap is authenticated
    const sameKey = randomBytes(32).toString("base64");
    const twin = parseKeyRing(`k1:${sameKey},k2:${sameKey}`);
    await encryptFile(plain, join(dir, "twin"), twin);
    const hdr = readFileSync(join(dir, "twin")); hdr.write("k2", 6); writeFileSync(join(dir, "hdr"), hdr);
    await assert.rejects(decryptFile(join(dir, "hdr"), join(dir, "o7"), twin), /authentication/, "the key id is authenticated even when both ids map to the same key");
    // not an archive
    writeFileSync(join(dir, "junk"), "hello world, this is not a backup");
    await assert.rejects(decryptFile(join(dir, "junk"), join(dir, "o8"), ring), /bad header/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("key rotation: new backups use the first key, old archives still decrypt with the old key", async () => {
  const dir = tmp();
  try {
    const old = keyOf("k1"), next = keyOf("k2");
    writeFileSync(join(dir, "p"), "data");
    await encryptFile(join(dir, "p"), join(dir, "old"), parseKeyRing(old));
    const rotated = parseKeyRing(`${next},${old}`);
    const meta = await encryptFile(join(dir, "p"), join(dir, "new"), rotated);
    assert.equal(meta.keyId, "k2");
    await decryptFile(join(dir, "old"), join(dir, "o1"), rotated);
    await decryptFile(join(dir, "new"), join(dir, "o2"), rotated);
    await assert.rejects(decryptFile(join(dir, "new"), join(dir, "o3"), parseKeyRing(old)), /No key "k2"/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pack/unpack round-trips files (including empty) and rejects path traversal and truncation", async () => {
  const dir = tmp();
  try {
    const src = join(dir, "src"); mkdirSync(src);
    writeFileSync(join(src, "a.ndjson.gz"), "AAAA"); writeFileSync(join(src, "empty.ndjson.gz"), ""); writeFileSync(join(src, "manifest.json"), "{}");
    await packDir(src, join(dir, "c.bin"));
    const names = await unpackDir(join(dir, "c.bin"), join(dir, "out"));
    assert.deepEqual(names.sort(), ["a.ndjson.gz", "empty.ndjson.gz", "manifest.json"]);
    assert.equal(readFileSync(join(dir, "out", "a.ndjson.gz"), "utf8"), "AAAA");
    assert.equal(readFileSync(join(dir, "out", "empty.ndjson.gz")).length, 0);
    // crafted container with a traversal name
    const evil = Buffer.concat([Buffer.from([0, 9]), Buffer.from("../escape"), Buffer.alloc(8), Buffer.alloc(2)]);
    writeFileSync(join(dir, "evil.bin"), evil);
    await assert.rejects(unpackDir(join(dir, "evil.bin"), join(dir, "evil-out")), /unsafe/);
    assert.equal(readdirSync(dir).includes("escape"), false);
    writeFileSync(join(dir, "cut.bin"), readFileSync(join(dir, "c.bin")).subarray(0, 12));
    await assert.rejects(unpackDir(join(dir, "cut.bin"), join(dir, "cut-out")), /truncated/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("retention keeps recent days, one per month and a minimum, never everything and never nothing", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const items = Array.from({ length: 400 }, (_, i) => ({ name: `b${i}`, createdAt: new Date(now.getTime() - i * 86400_000) }));
  const r = selectRetention(items, now, { keepDays: 35, keepMonthly: 12, keepMinimum: 3 });
  assert.ok(r.keep.includes("b0") && r.keep.includes("b35"), "everything inside 35 days is kept");
  assert.ok(!r.keep.includes("b36") || r.keep.length > 36, "older ones are only kept as monthly representatives");
  const months = new Set(r.keep.map((n) => items.find((i) => i.name === n)!.createdAt.toISOString().slice(0, 7)));
  assert.ok(months.size >= 12, "one backup survives for each of the last 12 months");
  assert.ok(r.remove.length > 250 && r.keep.length < 70);
  // minimum is honoured even if everything is old
  const old = [0, 1, 2, 3, 4].map((i) => ({ name: `o${i}`, createdAt: new Date("2024-01-0" + (i + 1) + "T00:00:00Z") }));
  assert.equal(selectRetention(old, now, { keepDays: 1, keepMonthly: 0, keepMinimum: 3 }).keep.length, 3);
  assert.deepEqual(selectRetention([], now).remove, []);
});

test("DirStore refuses unsafe object names and listing hides partial uploads", async () => {
  const dir = tmp();
  try {
    const store = new DirStore(join(dir, "store"));
    writeFileSync(join(dir, "f"), "x");
    for (const bad of ["../x", "a/b", "", ".hidden", "a b"]) await assert.rejects(store.put(bad, join(dir, "f")), /Invalid backup object name/);
    await store.put("ok.sqbak", join(dir, "f"));
    writeFileSync(join(dir, "store", "half.sqbak.part"), "partial");
    assert.deepEqual((await store.list()).map((o) => o.name), ["ok.sqbak"]);
    await assert.rejects(store.get("missing.sqbak", join(dir, "g")), /not found/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("storeFromEnv never falls back silently and names missing settings without printing secrets", () => {
  assert.throws(() => storeFromEnv({}), /No backup destination configured/);
  assert.throws(() => storeFromEnv({ BACKUP_S3_BUCKET: "b" }), /BACKUP_S3_REGION.*BACKUP_S3_ACCESS_KEY_ID.*BACKUP_S3_SECRET_ACCESS_KEY/);
  const s = storeFromEnv({ BACKUP_S3_BUCKET: "bk", BACKUP_S3_REGION: "ap-south-1", BACKUP_S3_ACCESS_KEY_ID: "AKIDEXAMPLE", BACKUP_S3_SECRET_ACCESS_KEY: "super-secret-value", BACKUP_S3_PREFIX: "prod" });
  assert.equal(s.label, "s3://bk/prod/");
  assert.ok(!JSON.stringify(s.label).includes("super-secret"));
});

test("restore target safety: environment, explicit database, protected targets and typed confirmation", () => {
  const live = "mongodb+srv://app:pw@cluster0.abcde.mongodb.net/studyquest?retryWrites=true";
  const ok = (uri: string, extra: object = {}) => assertSafeRestoreTarget({ targetUri: uri, environment: "staging", protectedUris: [live], ...extra });
  assert.throws(() => ok(live), /protected \(live\)/);
  assert.throws(() => ok("mongodb+srv://other:pw@CLUSTER0.abcde.mongodb.net/studyquest"), /protected \(live\)/, "same host and db with different credentials/case");
  assert.throws(() => ok("mongodb+srv://other:pw@cluster0.abcde.mongodb.net/"), /explicit database/);
  assert.throws(() => ok("mongodb+srv://other:pw@cluster0.abcde.mongodb.net"), /explicit database/);
  assert.throws(() => ok("mongodb://127.0.0.1/x", { environment: "production" }), /--environment must be one of/);
  assert.throws(() => ok("mongodb://127.0.0.1/x", { environment: "" }), /--environment/);
  assert.throws(() => ok("not-a-uri"), /Not a MongoDB connection string/);
  const t = ok("mongodb+srv://stg:pw@staging.abcde.mongodb.net/restore_drill");
  assert.equal(t.expected, "restore_drill@staging.abcde.mongodb.net");
  assert.equal(t.confirmed, false, "no confirmation = dry run");
  assert.equal(ok("mongodb+srv://stg:pw@staging.abcde.mongodb.net/restore_drill", { confirm: "restore_drill@staging.abcde.mongodb.net" }).confirmed, true);
  assert.equal(ok("mongodb+srv://stg:pw@staging.abcde.mongodb.net/restore_drill", { confirm: "studyquest@cluster0.abcde.mongodb.net" }).confirmed, false, "confirming a different database does not count");
  // protected list in host/db form and a live URI without a db name protects the whole host
  assert.throws(() => assertSafeRestoreTarget({ targetUri: "mongodb://h1:27017,h2:27017/prod", environment: "qa", protectedUris: ["h2,h1/prod"] }), /Refusing|protected/);
  assert.throws(() => assertSafeRestoreTarget({ targetUri: "mongodb://h1/anything", environment: "qa", protectedUris: ["mongodb://u:p@h1"] }), /protected/);
  assert.equal(targetFingerprint("mongodb://u:p@H1:27017,h2/db?x=1").fingerprint, "h1,h2/db");
});

test("credentials never survive scrubbing", () => {
  const msg = "connect failed for mongodb+srv://admin:p%40ss@cluster0.x.mongodb.net/db and mongodb://u:pw@h/db";
  const clean = scrubSecrets(msg);
  assert.ok(!/p%40ss|:pw@|admin:/.test(clean), clean);
  assert.ok(clean.includes("mongodb+srv://***@cluster0"));
});

async function seedStore(store: DirStore, entries: { at: Date; sidecar?: boolean; size?: number; recorded?: number; docs?: number }[]) {
  const dir = tmp();
  try {
    for (const e of entries) {
      const name = stampName(e.at);
      writeFileSync(join(dir, "a"), "x".repeat(e.size ?? 100));
      await store.put(name, join(dir, "a"));
      if (e.sidecar !== false) { writeFileSync(join(dir, "s"), JSON.stringify({ format: 1, name, createdAt: e.at.toISOString(), sourceDb: "studyquest", keyId: "k1", size: e.recorded ?? e.size ?? 100, sha256: "00", collections: 3, documents: e.docs ?? 1000, startedAt: e.at.toISOString(), durationMs: 1 })); await store.put(name + ".json", join(dir, "s")); }
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("backup health check: missing, stale, incomplete, truncated and shrunken backups are all reported", async () => {
  const root = tmp();
  const now = new Date("2026-11-14T12:00:00Z");
  try {
    const empty = new DirStore(join(root, "empty"));
    const none = await checkBackups({ store: empty, now });
    assert.equal(none.ok, false); assert.match(none.problems[0], /No backups exist/);

    const fresh = new DirStore(join(root, "fresh"));
    await seedStore(fresh, [{ at: ago(2) }, { at: ago(26) }]);
    const good = await checkBackups({ store: fresh, now });
    assert.equal(good.ok, true, JSON.stringify(good)); assert.equal(good.backups, 2);

    const stale = new DirStore(join(root, "stale"));
    await seedStore(stale, [{ at: ago(60) }]);
    const s = await checkBackups({ store: stale, now });
    assert.equal(s.ok, false); assert.match(s.problems.join(), /stale/);

    const incomplete = new DirStore(join(root, "inc"));
    await seedStore(incomplete, [{ at: ago(5), sidecar: false }, { at: ago(30) }]);
    const i = await checkBackups({ store: incomplete, now });
    assert.match(i.problems.join(), /incomplete \(sidecar missing\)/);
    assert.equal(i.ok, false, "the newest backup never completed and the last good one is stale");

    const truncated = new DirStore(join(root, "trunc"));
    await seedStore(truncated, [{ at: ago(1), size: 50, recorded: 100 }]);
    assert.match((await checkBackups({ store: truncated, now })).problems.join(), /does not match the recorded/);

    const orphan = new DirStore(join(root, "orphan"));
    await seedStore(orphan, [{ at: ago(1) }]);
    rmSync(join(root, "orphan", stampName(ago(1))));
    assert.match((await checkBackups({ store: orphan, now })).problems.join(), /archive missing/);

    const shrunk = new DirStore(join(root, "shrunk"));
    await seedStore(shrunk, [{ at: ago(1), docs: 100 }, { at: ago(25), docs: 1000 }]);
    const sh = await checkBackups({ store: shrunk, now });
    assert.equal(sh.ok, true); assert.match(sh.warnings.join(), /less than half/);

    const few = await checkBackups({ store: fresh, now, minCount: 5 });
    assert.match(few.problems.join(), /at least 5 required/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("pruning removes only expired complete backups and leaves incomplete ones for the health check", async () => {
  const root = tmp();
  const now = new Date("2026-11-14T12:00:00Z");
  try {
    const store = new DirStore(join(root, "s"));
    const days = [0, 1, 2, 3, 10, 40, 41, 70, 200];
    await seedStore(store, days.map((d) => ({ at: new Date(now.getTime() - d * 86400_000) })));
    await seedStore(store, [{ at: new Date(now.getTime() - 100 * 86400_000), sidecar: false }]);
    const r = await pruneBackups({ store, now, policy: { keepDays: 35, keepMonthly: 2, keepMinimum: 3 } });
    assert.ok(r.kept.length >= 5 && r.removed.length >= 1);
    const left = (await store.list()).map((o) => o.name);
    assert.ok(left.some((n) => n.includes("studyquest") && !n.endsWith(".json")), "archives remain");
    assert.ok(left.includes(stampName(new Date(now.getTime() - 100 * 86400_000))), "incomplete archive untouched");
    for (const name of r.removed) assert.ok(!left.includes(name) && !left.includes(name + ".json"), "archive and sidecar removed together");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// A minimal S3 endpoint (path-style) that also checks that requests are SigV4-signed with the configured access key.
function fakeS3(): Promise<{ server: Server; url: string; objects: Map<string, Buffer>; unsigned: number }> {
  const objects = new Map<string, Buffer>();
  const state = { unsigned: 0 };
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const auth = req.headers.authorization ?? "";
        if (!/^AWS4-HMAC-SHA256 Credential=AKIDTEST\//.test(auth)) { state.unsigned++; res.writeHead(403); return res.end("<Error><Code>AccessDenied</Code></Error>"); }
        const u = new URL(req.url!, "http://x");
        const parts = u.pathname.split("/").filter(Boolean); // bucket, ...key
        const key = parts.slice(1).map(decodeURIComponent).join("/");
        if (req.method === "PUT") { let body = Buffer.concat(chunks); if (req.headers["content-encoding"]?.includes("aws-chunked")) body = unchunk(body); objects.set(key, body); res.writeHead(200, { ETag: '"x"' }); return res.end(); }
        if (req.method === "GET" && u.searchParams.get("list-type") === "2") {
          const prefix = u.searchParams.get("prefix") ?? "";
          const xml = `<?xml version="1.0"?><ListBucketResult><Name>${parts[0]}</Name><IsTruncated>false</IsTruncated>${[...objects].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => `<Contents><Key>${k}</Key><Size>${v.length}</Size><LastModified>2026-11-14T00:00:00.000Z</LastModified></Contents>`).join("")}</ListBucketResult>`;
          res.writeHead(200, { "Content-Type": "application/xml" }); return res.end(xml);
        }
        if (req.method === "GET") { const o = objects.get(key); if (!o) { res.writeHead(404, { "Content-Type": "application/xml" }); return res.end("<Error><Code>NoSuchKey</Code></Error>"); } res.writeHead(200, { "Content-Length": o.length }); return res.end(o); }
        if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
        res.writeHead(405); res.end();
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, objects, get unsigned() { return state.unsigned; } }));
  });
}
function unchunk(b: Buffer) { // strips aws-chunked framing if the SDK used it
  const out: Buffer[] = []; let i = 0;
  while (i < b.length) { const eol = b.indexOf("\r\n", i); const size = parseInt(b.subarray(i, eol).toString().split(";")[0], 16); if (!size) break; out.push(b.subarray(eol + 2, eol + 2 + size)); i = eol + 2 + size + 2; }
  return Buffer.concat(out);
}

test("S3Store uploads, lists, downloads and deletes through a signed S3-compatible endpoint; bad credentials fail", async () => {
  const s3 = await fakeS3();
  const dir = tmp();
  try {
    const cfg = { bucket: "bk", prefix: "prod/", region: "us-east-1", endpoint: s3.url, accessKeyId: "AKIDTEST", secretAccessKey: "secret" };
    const store = new S3Store(cfg);
    writeFileSync(join(dir, "f"), randomBytes(200000));
    await store.put("studyquest-db-20261114T000000Z.sqbak", join(dir, "f"));
    assert.ok(s3.objects.has("prod/studyquest-db-20261114T000000Z.sqbak"), "stored under the configured prefix");
    const listed = await store.list();
    assert.deepEqual(listed.map((o) => [o.name, o.size]), [["studyquest-db-20261114T000000Z.sqbak", 200000]]);
    await store.get("studyquest-db-20261114T000000Z.sqbak", join(dir, "g"));
    assert.deepEqual(readFileSync(join(dir, "g")), readFileSync(join(dir, "f")));
    await assert.rejects(store.get("studyquest-db-20990101T000000Z.sqbak", join(dir, "h")));
    await store.remove("studyquest-db-20261114T000000Z.sqbak");
    assert.equal((await store.list()).length, 0);
    const bad = new S3Store({ ...cfg, accessKeyId: "WRONG" });
    await assert.rejects(bad.put("studyquest-db-20261114T000001Z.sqbak", join(dir, "f")));
    assert.ok(s3.unsigned >= 1, "the endpoint rejected the unknown credentials");
  } finally { s3.server.close(); rmSync(dir, { recursive: true, force: true }); }
});
