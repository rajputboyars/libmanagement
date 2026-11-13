import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import mongoose from "mongoose";

const { EJSON } = mongoose.mongo.BSON;
export type RelationshipStat = { rule: string; orphans: number; crossTenant: number };
export type Manifest = {
  createdAt: string;
  sourceDb: string;
  collections: { name: string; count: number; sha256: string; indexes: unknown[]; tenantCounts?: Record<string, number> }[];
  /** Referential and tenant-consistency statistics of the SOURCE; a faithful restore must reproduce them exactly. */
  relationships?: RelationshipStat[];
};

/** Essential parent/child relationships. `sameTenant` also requires the child's libraryId to equal its parent's. */
const RULES: { child: string; field: string; parent: string; sameTenant?: boolean }[] = [
  { child: "memberships", field: "libraryId", parent: "libraries" },
  { child: "memberships", field: "userId", parent: "users" },
  { child: "payments", field: "membershipId", parent: "memberships", sameTenant: true },
  { child: "seatassignments", field: "membershipId", parent: "memberships", sameTenant: true },
  { child: "seatassignments", field: "seatId", parent: "seats", sameTenant: true },
  { child: "seats", field: "libraryId", parent: "libraries" },
  { child: "libraries", field: "ownerId", parent: "users" },
  { child: "organizationmemberships", field: "organizationId", parent: "organizations" },
];

async function relationshipStats(db: import("mongodb").Db, present: Set<string>): Promise<RelationshipStat[]> {
  const out: RelationshipStat[] = [];
  for (const r of RULES) {
    if (!present.has(r.child) || !present.has(r.parent)) continue;
    const base = [{ $match: { [r.field]: { $ne: null } } }, { $lookup: { from: r.parent, localField: r.field, foreignField: "_id", as: "p" } }];
    const orphans = (await db.collection(r.child).aggregate([...base, { $match: { p: { $size: 0 } } }, { $count: "n" }]).toArray())[0]?.n ?? 0;
    const crossTenant = r.sameTenant
      ? ((await db.collection(r.child).aggregate([...base, { $match: { $expr: { $and: [{ $gt: [{ $size: "$p" }, 0] }, { $ne: [{ $arrayElemAt: ["$p.libraryId", 0] }, "$libraryId"] }] } } }, { $count: "n" }]).toArray())[0]?.n ?? 0)
      : 0;
    out.push({ rule: `${r.child}.${r.field} -> ${r.parent}${r.sameTenant ? " (same library)" : ""}`, orphans, crossTenant });
  }
  return out;
}

async function tenantCounts(db: import("mongodb").Db, name: string) {
  const rows = await db.collection(name).aggregate([{ $match: { libraryId: { $ne: null } } }, { $group: { _id: "$libraryId", n: { $sum: 1 } } }]).toArray();
  return rows.length ? Object.fromEntries(rows.map((r) => [String(r._id), r.n as number])) : undefined;
}

/** "host1,host2/dbname" (credentials and options removed). Used to recognise the live database without ever logging a URI. */
export function targetFingerprint(uri: string) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/.exec(uri.trim());
  if (!m) throw new Error("Not a MongoDB connection string");
  const hosts = m[1].toLowerCase().split(",").map((h) => h.replace(/:27017$/, "")).sort().join(",");
  return { hosts, db: m[2] ?? "", fingerprint: `${hosts}/${m[2] ?? ""}` };
}
/** Strips credentials from any text so connection strings never reach logs or alerts. */
export const scrubSecrets = (text: string) => text.replace(/(mongodb(?:\+srv)?:\/\/)[^@\s/]+@/gi, "$1***@");

const sha = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/**
 * Logical backup: one gzip NDJSON file per collection (Extended JSON keeps ObjectIds and dates exact) plus a manifest with
 * counts and checksums. Read-only against the source. For production, prefer provider-native continuous backups (see docs/BACKUP_RESTORE.md);
 * this is the portable, verifiable fallback and the basis of restore drills.
 */
export async function backupDatabase(uri: string, outDir: string) {
  const conn = await mongoose.createConnection(uri).asPromise();
  try {
    mkdirSync(outDir, { recursive: true });
    const db = conn.db!;
    const manifest: Manifest = { createdAt: new Date().toISOString(), sourceDb: db.databaseName, collections: [] };
    for (const info of await db.listCollections({}, { nameOnly: true }).toArray()) {
      if (info.name.startsWith("system.")) continue;
      const file = join(outDir, `${info.name}.ndjson.gz`);
      let count = 0;
      const lines = (async function* () { for await (const doc of db.collection(info.name).find({}, { batchSize: 500 })) { count++; yield EJSON.stringify(doc, { relaxed: false }) + "\n"; } })();
      await pipeline(lines, createGzip(), createWriteStream(file));
      manifest.collections.push({ name: info.name, count, sha256: sha(file), indexes: await db.collection(info.name).indexes(), tenantCounts: await tenantCounts(db, info.name) });
    }
    manifest.relationships = await relationshipStats(db, new Set(manifest.collections.map((c) => c.name)));
    writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  } finally { await conn.close(); }
}

export async function verifyBackup(dir: string) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as Manifest;
  const problems: string[] = [];
  for (const c of manifest.collections) {
    const file = join(dir, `${c.name}.ndjson.gz`);
    if (!existsSync(file)) problems.push(`${c.name}: file missing`);
    else if (sha(file) !== c.sha256) problems.push(`${c.name}: checksum mismatch`);
  }
  return { manifest, problems };
}

/**
 * Restores into an explicit, EMPTY target database. It never defaults to the application's MONGODB_URI, refuses non-empty targets
 * unless allowNonEmpty is set, and verifies document counts afterwards.
 * Indexes (including unique ones, which then also validate the data) are created on the empty collections BEFORE the documents are
 * loaded. TTL indexes are returned in `deferred` instead: they would start deleting expired documents while the restore is still being
 * verified, so the caller creates them with applyDeferredIndexes() after verification.
 */
export type DeferredIndexes = { collection: string; specs: Record<string, unknown>[] }[];
export async function restoreDatabase(dir: string, targetUri: string, opts: { allowNonEmpty?: boolean } = {}) {
  const { manifest, problems } = await verifyBackup(dir);
  if (problems.length) throw new Error(`Backup failed verification: ${problems.join("; ")}`);
  const conn = await mongoose.createConnection(targetUri).asPromise();
  try {
    const db = conn.db!;
    const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).filter((c) => !c.name.startsWith("system."));
    if (existing.length && !opts.allowNonEmpty) throw new Error(`Target database "${db.databaseName}" is not empty (${existing.length} collections). Restore into a fresh database.`);
    const restored: Record<string, number> = {};
    const deferred: DeferredIndexes = [];
    for (const c of manifest.collections) {
      const all = (c.indexes as { name: string; expireAfterSeconds?: number; [k: string]: unknown }[]).filter((idx) => idx.name !== "_id_").map((idx) => { const { v, ns, ...rest } = idx as { v?: unknown; ns?: unknown; name: string; expireAfterSeconds?: number; [k: string]: unknown }; void v; void ns; return rest; });
      const ttl = all.filter((i) => typeof i.expireAfterSeconds === "number"), plain = all.filter((i) => typeof i.expireAfterSeconds !== "number");
      if (plain.length) await db.collection(c.name).createIndexes(plain as never).catch(async () => { for (const spec of plain) await db.collection(c.name).createIndexes([spec] as never).catch(() => null); });
      else await db.createCollection(c.name);
      if (ttl.length) deferred.push({ collection: c.name, specs: ttl });
      const rl = createInterface({ input: createReadStream(join(dir, `${c.name}.ndjson.gz`)).pipe(createGunzip()), crlfDelay: Infinity });
      let batch: unknown[] = [], count = 0;
      const flush = async () => { if (batch.length) { await db.collection(c.name).insertMany(batch as never[], { ordered: false }); count += batch.length; batch = []; } };
      for await (const line of rl) { if (!line) continue; batch.push(EJSON.parse(line, { relaxed: false })); if (batch.length >= 500) await flush(); }
      await flush();
      restored[c.name] = count;
    }
    const mismatches = manifest.collections.filter((c) => restored[c.name] !== c.count).map((c) => `${c.name}: expected ${c.count}, restored ${restored[c.name]}`);
    return { restored, mismatches, ok: mismatches.length === 0, deferred };
  } finally { await conn.close(); }
}

/** Creates the TTL indexes held back by restoreDatabase(). Call only after the restore has been verified. */
export async function applyDeferredIndexes(targetUri: string, deferred: DeferredIndexes) {
  if (!deferred.length) return;
  const conn = await mongoose.createConnection(targetUri).asPromise();
  try { for (const d of deferred) await conn.db!.collection(d.collection).createIndexes(d.specs as never); } finally { await conn.close(); }
}

/**
 * Verifies a restored database against the backup manifest: every collection present with the exact count, every index rebuilt,
 * per-library (tenant) document counts identical, and referential / cross-tenant statistics identical to the source.
 */
export async function verifyRestored(manifest: Manifest, targetUri: string, opts: { skipTtlIndexes?: boolean; indexesOnly?: boolean } = {}) {
  const conn = await mongoose.createConnection(targetUri).asPromise();
  const problems: string[] = [], warnings: string[] = [];
  try {
    const db = conn.db!;
    const present = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const c of manifest.collections) {
      if (!present.has(c.name)) { problems.push(`${c.name}: collection missing after restore`); continue; }
      const count = opts.indexesOnly ? c.count : await db.collection(c.name).countDocuments();
      if (count !== c.count) problems.push(`${c.name}: expected ${c.count} documents, found ${count}`);
      const have = new Set((await db.collection(c.name).indexes()).map((i) => i.name));
      for (const idx of c.indexes as { name: string; expireAfterSeconds?: number }[]) if (!have.has(idx.name) && !(opts.skipTtlIndexes && typeof idx.expireAfterSeconds === "number")) problems.push(`${c.name}: index ${idx.name} missing`);
      if (c.tenantCounts && !opts.indexesOnly) {
        const now = (await tenantCounts(db, c.name)) ?? {};
        for (const k of new Set([...Object.keys(c.tenantCounts), ...Object.keys(now)])) if ((c.tenantCounts[k] ?? 0) !== (now[k] ?? 0)) problems.push(`${c.name}: library ${k} has ${now[k] ?? 0} documents, backup had ${c.tenantCounts[k] ?? 0}`);
      }
    }
    if (manifest.relationships && !opts.indexesOnly) {
      const now = await relationshipStats(db, present);
      for (const before of manifest.relationships) {
        const after = now.find((r) => r.rule === before.rule);
        if (!after) problems.push(`relationship check missing: ${before.rule}`);
        else if (after.orphans !== before.orphans || after.crossTenant !== before.crossTenant) problems.push(`relationship changed: ${before.rule} (orphans ${before.orphans}->${after.orphans}, cross-tenant ${before.crossTenant}->${after.crossTenant})`);
        if (before.crossTenant > 0) problems.push(`source already had cross-tenant references: ${before.rule} (${before.crossTenant})`);
        else if (before.orphans > 0) warnings.push(`source already had ${before.orphans} orphaned reference(s): ${before.rule}`);
      }
    } else if (!opts.indexesOnly) warnings.push("backup has no relationship statistics (older format): relationships were not verified");
    return { ok: problems.length === 0, problems, warnings, collections: manifest.collections.length, documents: manifest.collections.reduce((n, c) => n + c.count, 0) };
  } finally { await conn.close(); }
}
