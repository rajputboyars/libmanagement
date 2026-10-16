import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import mongoose from "mongoose";

const { EJSON } = mongoose.mongo.BSON;
type Manifest = { createdAt: string; sourceDb: string; collections: { name: string; count: number; sha256: string; indexes: unknown[] }[] };

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
      manifest.collections.push({ name: info.name, count, sha256: sha(file), indexes: await db.collection(info.name).indexes() });
    }
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
 */
export async function restoreDatabase(dir: string, targetUri: string, opts: { allowNonEmpty?: boolean } = {}) {
  const { manifest, problems } = await verifyBackup(dir);
  if (problems.length) throw new Error(`Backup failed verification: ${problems.join("; ")}`);
  const conn = await mongoose.createConnection(targetUri).asPromise();
  try {
    const db = conn.db!;
    const existing = (await db.listCollections({}, { nameOnly: true }).toArray()).filter((c) => !c.name.startsWith("system."));
    if (existing.length && !opts.allowNonEmpty) throw new Error(`Target database "${db.databaseName}" is not empty (${existing.length} collections). Restore into a fresh database.`);
    const restored: Record<string, number> = {};
    for (const c of manifest.collections) {
      const rl = createInterface({ input: createReadStream(join(dir, `${c.name}.ndjson.gz`)).pipe(createGunzip()), crlfDelay: Infinity });
      let batch: unknown[] = [], count = 0;
      const flush = async () => { if (batch.length) { await db.collection(c.name).insertMany(batch as never[], { ordered: false }); count += batch.length; batch = []; } };
      for await (const line of rl) { if (!line) continue; batch.push(EJSON.parse(line, { relaxed: false })); if (batch.length >= 500) await flush(); }
      await flush();
      restored[c.name] = count;
      for (const idx of c.indexes as { key: Record<string, number>; name: string; [k: string]: unknown }[]) {
        if (idx.name === "_id_") continue;
        const { key, v, ns, ...options } = idx as { key: Record<string, number>; v?: unknown; ns?: unknown; [k: string]: unknown };
        void v; void ns;
        await db.collection(c.name).createIndex(key as never, options as never).catch(() => null);
      }
    }
    const mismatches = manifest.collections.filter((c) => restored[c.name] !== c.count).map((c) => `${c.name}: expected ${c.count}, restored ${restored[c.name]}`);
    return { restored, mismatches, ok: mismatches.length === 0 };
  } finally { await conn.close(); }
}
