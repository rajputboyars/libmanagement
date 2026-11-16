import { mkdirSync, mkdtempSync, rmSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyDeferredIndexes, backupDatabase, restoreDatabase, scrubSecrets, targetFingerprint, verifyBackup, verifyRestored, type Manifest } from "./backup";
import { decryptFile, encryptFile, packDir, unpackDir, type KeyRing } from "./backup-crypto";
import type { BackupStore, StoredObject } from "./backup-store";

export const ARCHIVE_EXT = ".sqbak";
const NAME = /^studyquest-([A-Za-z0-9_-]{1,64})-(\d{8}T\d{6}Z)\.sqbak$/;
export type Sidecar = { format: 1; name: string; createdAt: string; sourceDb: string; keyId: string; size: number; sha256: string; collections: number; documents: number; startedAt: string; durationMs: number };

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const workDir = () => { const base = process.env.BACKUP_TMP_DIR || tmpdir(); mkdirSync(base, { recursive: true, mode: 0o700 }); return mkdtempSync(join(base, "sq-backup-")); };
const wipe = (dir: string) => rmSync(dir, { recursive: true, force: true });
const parseTime = (name: string) => { const m = NAME.exec(name); if (!m) return null; const s = m[2]; return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`); };

/**
 * Takes a consistent logical backup of `uri`, encrypts it (AES-256-GCM) and uploads it with a sidecar summary. The temporary plaintext
 * directory is always wiped. Success is declared only after the stored object's size is confirmed and the local manifest verified.
 */
export async function runBackup(opts: { uri: string; store: BackupStore; ring: KeyRing; now?: Date; allowEmpty?: boolean }) {
  const started = opts.now ?? new Date();
  const t0 = Date.now();
  const dir = workDir();
  try {
    const data = join(dir, "data");
    let manifest: Manifest;
    try { manifest = await backupDatabase(opts.uri, data); }
    catch (e) { throw new Error(`Database dump failed: ${scrubSecrets(e instanceof Error ? e.message : String(e))}`); }
    const documents = manifest.collections.reduce((n, c) => n + c.count, 0);
    if (!opts.allowEmpty && (manifest.collections.length === 0 || documents === 0)) throw new Error("Refusing to publish an empty backup: the database has no documents (wrong connection string or an emptied database?)");
    const { problems } = await verifyBackup(data);
    if (problems.length) throw new Error(`Backup failed local verification: ${problems.join("; ")}`);
    const plain = join(dir, "plain.bin"), archive = join(dir, "archive.sqbak");
    await packDir(data, plain);
    const enc = await encryptFile(plain, archive, opts.ring);
    rmSync(plain, { force: true });
    const name = `studyquest-${manifest.sourceDb.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "db"}-${stamp(started)}${ARCHIVE_EXT}`;
    const sidecar: Sidecar = { format: 1, name, createdAt: started.toISOString(), sourceDb: manifest.sourceDb, keyId: enc.keyId, size: enc.size, sha256: enc.sha256, collections: manifest.collections.length, documents, startedAt: started.toISOString(), durationMs: Date.now() - t0 };
    await opts.store.put(name, archive);
    const stored = (await opts.store.list()).find((o) => o.name === name);
    if (!stored || stored.size !== enc.size) throw new Error(`Upload verification failed: stored object ${stored ? `has ${stored.size} bytes, expected ${enc.size}` : "is missing"}`);
    const side = join(dir, "sidecar.json");
    writeFileSync(side, JSON.stringify(sidecar, null, 2));
    await opts.store.put(`${name}.json`, side); // written last: an archive without its sidecar counts as incomplete
    return { name, sidecar, manifest };
  } finally { wipe(dir); }
}

type Entry = { name: string; createdAt: Date; archive?: StoredObject; sidecar?: StoredObject };
function groupEntries(list: StoredObject[]) {
  const map = new Map<string, Entry>();
  for (const o of list) {
    const base = o.name.endsWith(".json") ? o.name.slice(0, -5) : o.name;
    const t = parseTime(base);
    if (!t) continue;
    const e = map.get(base) ?? { name: base, createdAt: t };
    if (o.name.endsWith(".json")) e.sidecar = o; else e.archive = o;
    map.set(base, e);
  }
  return [...map.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

async function readSidecar(store: BackupStore, name: string): Promise<Sidecar> {
  const dir = workDir();
  try { const p = join(dir, "s.json"); await store.get(`${name}.json`, p); return JSON.parse(readFileSync(p, "utf8")) as Sidecar; } finally { wipe(dir); }
}

export type CheckReport = { ok: boolean; checkedAt: string; latest?: { name: string; ageHours: number; documents?: number }; backups: number; problems: string[]; warnings: string[]; deep?: { name: string; verified: boolean } };

/**
 * Detects missing, stale, incomplete, truncated or corrupted backups. `deep` additionally downloads the newest archive, decrypts it
 * (GCM authentication) and verifies every collection checksum, which proves the key works and the data is intact.
 */
export async function checkBackups(opts: { store: BackupStore; now?: Date; maxAgeHours?: number; minCount?: number; deep?: { ring: KeyRing } }): Promise<CheckReport> {
  const now = opts.now ?? new Date();
  const maxAge = opts.maxAgeHours ?? 26, minCount = opts.minCount ?? 1;
  const problems: string[] = [], warnings: string[] = [];
  const entries = groupEntries(await opts.store.list());
  const report: CheckReport = { ok: false, checkedAt: now.toISOString(), backups: 0, problems, warnings };
  if (!entries.length) { problems.push("No backups exist in the configured destination"); return report; }
  const complete: Entry[] = [];
  for (const e of entries) {
    if (e.archive && !e.sidecar) { if (now.getTime() - e.createdAt.getTime() > 3600_000) problems.push(`${e.name}: incomplete (sidecar missing)`); continue; }
    if (!e.archive && e.sidecar) { problems.push(`${e.name}: archive missing (only the sidecar exists)`); continue; }
    complete.push(e);
  }
  report.backups = complete.length;
  if (complete.length < minCount) problems.push(`Only ${complete.length} complete backup(s); at least ${minCount} required`);
  const latest = complete[0];
  if (!latest) return report;
  const ageHours = (now.getTime() - latest.createdAt.getTime()) / 3600_000;
  report.latest = { name: latest.name, ageHours: Math.round(ageHours * 10) / 10 };
  if (ageHours > maxAge) problems.push(`Latest backup is stale: ${Math.round(ageHours)}h old (limit ${maxAge}h)`);
  try {
    const side = await readSidecar(opts.store, latest.name);
    report.latest.documents = side.documents;
    if (side.size !== latest.archive!.size) problems.push(`${latest.name}: size ${latest.archive!.size} does not match the recorded ${side.size} (truncated or corrupted)`);
    const prev = complete[1];
    if (prev) { try { const p = await readSidecar(opts.store, prev.name); if (p.documents > 20 && side.documents < p.documents * 0.5) warnings.push(`Latest backup has ${side.documents} documents, less than half of the previous ${p.documents}`); } catch { /* previous sidecar unreadable: reported by its own check */ } }
  } catch (e) { problems.push(`${latest.name}: sidecar unreadable (${scrubSecrets(e instanceof Error ? e.message : String(e))})`); }
  if (opts.deep) {
    const dir = workDir();
    try {
      await opts.store.get(latest.name, join(dir, "a.sqbak"));
      await decryptFile(join(dir, "a.sqbak"), join(dir, "p.bin"), opts.deep.ring);
      await unpackDir(join(dir, "p.bin"), join(dir, "data"));
      const v = await verifyBackup(join(dir, "data"));
      if (v.problems.length) problems.push(`${latest.name}: ${v.problems.join("; ")}`);
      report.deep = { name: latest.name, verified: v.problems.length === 0 };
    } catch (e) { problems.push(`${latest.name}: deep verification failed (${scrubSecrets(e instanceof Error ? e.message : String(e))})`); report.deep = { name: latest.name, verified: false }; }
    finally { wipe(dir); }
  }
  report.ok = problems.length === 0;
  return report;
}

export type RetentionPolicy = { keepDays: number; keepMonthly: number; keepMinimum: number };
export const DEFAULT_RETENTION: RetentionPolicy = { keepDays: 35, keepMonthly: 12, keepMinimum: 3 };
/** Keeps everything newer than keepDays, the newest backup of each of the last keepMonthly months, and always the newest keepMinimum. */
export function selectRetention(items: { name: string; createdAt: Date }[], now: Date, policy: RetentionPolicy = DEFAULT_RETENTION) {
  const sorted = [...items].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keep = new Set<string>();
  sorted.slice(0, Math.max(0, policy.keepMinimum)).forEach((i) => keep.add(i.name));
  for (const i of sorted) if (now.getTime() - i.createdAt.getTime() <= policy.keepDays * 86400_000) keep.add(i.name);
  const months = new Set<string>();
  for (const i of sorted) { const m = i.createdAt.toISOString().slice(0, 7); if (!months.has(m) && months.size < policy.keepMonthly) { months.add(m); keep.add(i.name); } }
  return { keep: sorted.filter((i) => keep.has(i.name)).map((i) => i.name), remove: sorted.filter((i) => !keep.has(i.name)).map((i) => i.name) };
}
/** Deletes expired archives (and sidecars). Incomplete entries are never counted as backups and are left for `check` to report. */
export async function pruneBackups(opts: { store: BackupStore; now?: Date; policy?: RetentionPolicy }) {
  const now = opts.now ?? new Date();
  const complete = groupEntries(await opts.store.list()).filter((e) => e.archive && e.sidecar);
  const { keep, remove } = selectRetention(complete, now, opts.policy);
  for (const name of remove) { await opts.store.remove(`${name}.json`); await opts.store.remove(name); }
  return { kept: keep, removed: remove };
}

export async function listBackups(store: BackupStore) { return groupEntries(await store.list()).map((e) => ({ name: e.name, createdAt: e.createdAt.toISOString(), complete: !!(e.archive && e.sidecar), size: e.archive?.size })); }

export const RESTORE_ENVIRONMENTS = ["staging", "qa", "drill", "recovery"] as const;
export type RestoreEnvironment = (typeof RESTORE_ENVIRONMENTS)[number];

/** Pure target validation, exported for tests. Throws with a specific, safe message. */
export function assertSafeRestoreTarget(o: { targetUri: string; environment: string; confirm?: string; protectedUris?: (string | undefined)[] }) {
  if (!RESTORE_ENVIRONMENTS.includes(o.environment as RestoreEnvironment)) throw new Error(`--environment must be one of ${RESTORE_ENVIRONMENTS.join(", ")} (use "recovery" only for a NEW empty database that will become production)`);
  const t = targetFingerprint(o.targetUri);
  if (!t.db) throw new Error("The target connection string must name an explicit database (…/<database name>)");
  for (const p of o.protectedUris ?? []) {
    if (!p) continue;
    for (const part of p.split(/;|\r?\n/).map((x) => x.trim()).filter(Boolean)) {
      const f = /^mongodb/.test(part) ? targetFingerprint(part) : { hosts: part.split("/")[0].toLowerCase().split(",").map((h) => h.trim()).sort().join(","), db: part.split("/")[1] ?? "" };
      if (f.hosts === t.hosts && (f.db === t.db || !f.db)) throw new Error("Refusing to restore into a protected (live) database. Restore into a NEW, empty database instead.");
    }
  }
  const expected = `${t.db}@${t.hosts.split(",")[0]}`;
  return { expected, confirmed: o.confirm === expected, target: t };
}

export type RestoreResult = { ok: boolean; dryRun: boolean; archive: string; environment: string; target: string; durationMs: number; steps: { step: string; ms: number }[]; documents?: number; collections?: number; problems: string[]; warnings: string[] };

/**
 * Restores an encrypted archive into an explicit, EMPTY database and verifies it. Without a matching --confirm it only downloads,
 * decrypts and verifies the archive (dry run). Success requires: authentication ok, checksums ok, counts ok, indexes, tenant
 * counts and relationships identical to the source. Backup-file creation is never treated as proof of recoverability.
 */
export async function restoreFromStore(opts: { store: BackupStore; ring: KeyRing; archive?: string; targetUri: string; environment: string; confirm?: string; protectedUris?: (string | undefined)[] }): Promise<RestoreResult> {
  const t0 = Date.now();
  const steps: RestoreResult["steps"] = [];
  const mark = (step: string, from: number) => steps.push({ step, ms: Date.now() - from });
  const safe = assertSafeRestoreTarget(opts);
  const name = opts.archive ?? (await listBackups(opts.store)).find((b) => b.complete)?.name;
  if (!name) throw new Error("No complete backup found to restore");
  if (!NAME.test(name)) throw new Error("Invalid archive name");
  const dir = workDir();
  const result: RestoreResult = { ok: false, dryRun: !safe.confirmed, archive: name, environment: opts.environment, target: safe.expected, durationMs: 0, steps, problems: [], warnings: [] };
  try {
    let s = Date.now();
    await opts.store.get(name, join(dir, "a.sqbak")); mark("download", s);
    s = Date.now();
    await decryptFile(join(dir, "a.sqbak"), join(dir, "p.bin"), opts.ring);
    await unpackDir(join(dir, "p.bin"), join(dir, "data")); mark("decrypt+unpack", s);
    s = Date.now();
    const { manifest, problems } = await verifyBackup(join(dir, "data"));
    mark("verify-archive", s);
    if (problems.length) { result.problems.push(...problems); return result; }
    result.collections = manifest.collections.length;
    result.documents = manifest.collections.reduce((n, c) => n + c.count, 0);
    if (!safe.confirmed) { result.ok = true; result.warnings.push(`Dry run: archive verified, nothing restored. To restore, repeat with --confirm "${safe.expected}"`); return result; }
    s = Date.now();
    const restored = await restoreDatabase(join(dir, "data"), opts.targetUri); // never allow non-empty targets
    mark("restore", s);
    if (!restored.ok) { result.problems.push(...restored.mismatches); return result; }
    s = Date.now();
    const v = await verifyRestored(manifest, opts.targetUri, { skipTtlIndexes: true });
    mark("verify-restored", s);
    result.problems.push(...v.problems); result.warnings.push(...v.warnings);
    if (!v.ok) return result;
    // TTL indexes were held back so they could not delete expired documents mid-verification; create and check them now.
    s = Date.now();
    await applyDeferredIndexes(opts.targetUri, restored.deferred);
    const final = await verifyRestored(manifest, opts.targetUri, { skipTtlIndexes: false, indexesOnly: true });
    mark("ttl-indexes", s);
    result.problems.push(...final.problems);
    result.ok = final.ok;
    return result;
  } catch (e) {
    result.problems.push(scrubSecrets(e instanceof Error ? e.message : String(e)));
    return result;
  } finally { wipe(dir); result.durationMs = Date.now() - t0; }
}

export const sizeOf = (p: string) => statSync(p).size;
