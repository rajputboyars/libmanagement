import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync, copyFileSync, renameSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type StoredObject = { name: string; size: number; modified: Date };
export interface BackupStore {
  readonly kind: string;
  /** Human-safe description for logs (never contains credentials). */
  readonly label: string;
  put(name: string, localPath: string): Promise<void>;
  get(name: string, localPath: string): Promise<void>;
  list(): Promise<StoredObject[]>;
  remove(name: string): Promise<void>;
}

const OBJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const assertName = (n: string) => { if (!OBJECT_NAME.test(n)) throw new Error(`Invalid backup object name: ${n.slice(0, 40)}`); };

/**
 * Directory store. Only meaningful in production when the directory is a mounted OFF-SITE volume (network/object mount);
 * a directory on the application host's own disk is NOT a backup destination. Used for drills and tests.
 */
export class DirStore implements BackupStore {
  readonly kind = "dir";
  readonly label: string;
  constructor(private root: string) { this.root = resolve(root); this.label = `dir:${this.root}`; mkdirSync(this.root, { recursive: true, mode: 0o700 }); }
  private path(name: string) { assertName(name); const p = join(this.root, name); if (!p.startsWith(this.root + sep)) throw new Error("Invalid backup object name"); return p; }
  async put(name: string, localPath: string) { const tmp = this.path(name) + ".part"; copyFileSync(localPath, tmp); renameSync(tmp, this.path(name)); }
  async get(name: string, localPath: string) {
    if (!existsSync(this.path(name))) throw new Error(`Backup object not found: ${name}`);
    mkdirSync(dirname(localPath), { recursive: true });
    await pipeline(createReadStream(this.path(name)), createWriteStream(localPath, { mode: 0o600 }));
  }
  async list() { return readdirSync(this.root).filter((n) => OBJECT_NAME.test(n) && !n.endsWith(".part")).map((n) => { const s = statSync(join(this.root, n)); return { name: n, size: s.size, modified: s.mtime }; }); }
  async remove(name: string) { rmSync(this.path(name), { force: true }); }
}

export type S3Config = { bucket: string; prefix: string; region: string; endpoint?: string; accessKeyId: string; secretAccessKey: string; forcePathStyle?: boolean };

/** S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO...). Objects are already client-side encrypted. */
export class S3Store implements BackupStore {
  readonly kind = "s3";
  readonly label: string;
  private client: S3Client;
  private prefix: string;
  constructor(private cfg: S3Config) {
    this.prefix = cfg.prefix ? cfg.prefix.replace(/^\/+|\/+$/g, "") + "/" : "";
    this.label = `s3://${cfg.bucket}/${this.prefix}`;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? !!cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      maxAttempts: 4,
    });
  }
  async put(name: string, localPath: string) {
    assertName(name);
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: this.prefix + name, Body: createReadStream(localPath), ContentLength: statSync(localPath).size, ContentType: "application/octet-stream" }));
  }
  async get(name: string, localPath: string) {
    assertName(name);
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.prefix + name }));
    if (!r.Body) throw new Error(`Backup object not found: ${name}`);
    mkdirSync(dirname(localPath), { recursive: true });
    await pipeline(r.Body as Readable, createWriteStream(localPath, { mode: 0o600 }));
  }
  async list() {
    const out: StoredObject[] = [];
    let token: string | undefined;
    do {
      const r = await this.client.send(new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: this.prefix, ContinuationToken: token }));
      for (const o of r.Contents ?? []) { const name = (o.Key ?? "").slice(this.prefix.length); if (OBJECT_NAME.test(name)) out.push({ name, size: o.Size ?? 0, modified: o.LastModified ?? new Date(0) }); }
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return out;
  }
  async remove(name: string) { assertName(name); await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: this.prefix + name })); }
}

/** Builds the configured store from the environment. Never falls back to a local directory silently. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): BackupStore {
  if (env.BACKUP_S3_BUCKET) {
    const need = ["BACKUP_S3_REGION", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
    if (need.length) throw new Error(`Missing backup storage settings: ${need.join(", ")}`);
    return new S3Store({ bucket: env.BACKUP_S3_BUCKET, prefix: env.BACKUP_S3_PREFIX ?? "studyquest/", region: env.BACKUP_S3_REGION!, endpoint: env.BACKUP_S3_ENDPOINT, accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!, secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY! });
  }
  if (env.BACKUP_DIR) return new DirStore(env.BACKUP_DIR);
  throw new Error("No backup destination configured: set BACKUP_S3_BUCKET (+ BACKUP_S3_REGION, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY) for off-site object storage, or BACKUP_DIR for a mounted off-site volume.");
}
