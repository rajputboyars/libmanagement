import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream, mkdirSync, openSync, closeSync, readSync, readdirSync, statSync, fstatSync, rmSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

/**
 * Encrypted, single-file backup archives.
 *   file   = "SQBK" | version(1) | keyIdLen(1) | keyId | iv(12) | AES-256-GCM ciphertext | tag(16)
 *   plain  = repeated [nameLen u16][name][size u64][bytes]  then [0 u16]   (the backup directory's files)
 * The header is authenticated (AAD), so a swapped key id or version is detected. Decryption writes to a temp file and only
 * releases it after the GCM tag verified, so unauthenticated data is never restored.
 */
export type KeyRing = { active: { id: string; key: Buffer }; byId: Map<string, Buffer> };
const MAGIC = Buffer.from("SQBK");
const TAG = 16;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;

/** BACKUP_ENCRYPTION_KEYS="id1:<base64 32 bytes>,id2:<base64 32 bytes>" — the FIRST key encrypts new backups, all keys decrypt. */
export function parseKeyRing(raw: string | undefined): KeyRing {
  if (!raw?.trim()) throw new Error("BACKUP_ENCRYPTION_KEYS is not set. Generate a key with: node -e \"console.log('k1:'+require('crypto').randomBytes(32).toString('base64'))\"");
  const byId = new Map<string, Buffer>();
  let active: { id: string; key: Buffer } | undefined;
  for (const part of raw.split(",")) {
    const i = part.indexOf(":");
    const id = part.slice(0, i).trim(), b64 = part.slice(i + 1).trim();
    if (i < 1 || !/^[A-Za-z0-9_-]{1,32}$/.test(id)) throw new Error("BACKUP_ENCRYPTION_KEYS entries must look like id:base64key (id up to 32 letters, digits, - or _)");
    const key = Buffer.from(b64, "base64");
    if (key.length !== 32) throw new Error(`Backup key "${id}" must be exactly 32 bytes (base64)`);
    if (byId.has(id)) throw new Error(`Duplicate backup key id "${id}"`);
    byId.set(id, key);
    active ??= { id, key };
  }
  return { active: active!, byId };
}

export async function encryptFile(plainPath: string, outPath: string, ring: KeyRing) {
  const iv = randomBytes(12);
  const keyId = Buffer.from(ring.active.id);
  const header = Buffer.concat([MAGIC, Buffer.from([1, keyId.length]), keyId, iv]);
  const cipher = createCipheriv("aes-256-gcm", ring.active.key, iv);
  cipher.setAAD(header);
  const out = createWriteStream(outPath, { mode: 0o600 });
  out.write(header);
  const sha = createHash("sha256");
  sha.update(header);
  await pipeline(createReadStream(plainPath), cipher, async function* (src) { for await (const chunk of src as AsyncIterable<Buffer>) { sha.update(chunk); yield chunk; } }, out, { end: false });
  const tag = cipher.getAuthTag();
  sha.update(tag);
  await new Promise<void>((res, rej) => out.end(tag, (e?: Error | null) => (e ? rej(e) : res())));
  return { keyId: ring.active.id, sha256: sha.digest("hex"), size: statSync(outPath).size };
}

export function readHeader(path: string) {
  const fd = openSync(path, "r");
  try {
    const size = fstatSync(fd).size;
    const head = Buffer.alloc(6);
    if (readSync(fd, head, 0, 6, 0) < 6 || !head.subarray(0, 4).equals(MAGIC)) throw new Error("Not a StudyQuest backup archive (bad header)");
    if (head[4] !== 1) throw new Error(`Unsupported backup archive version ${head[4]}`);
    const idLen = head[5];
    const rest = Buffer.alloc(idLen + 12);
    if (readSync(fd, rest, 0, rest.length, 6) < rest.length) throw new Error("Backup archive is truncated");
    if (size < 6 + rest.length + TAG) throw new Error("Backup archive is truncated");
    return { keyId: rest.subarray(0, idLen).toString(), iv: rest.subarray(idLen), headerLen: 6 + idLen + 12, size, header: Buffer.concat([head, rest.subarray(0, idLen), rest.subarray(idLen)]) };
  } finally { closeSync(fd); }
}

/** Decrypts to `outPath`. Throws (and removes the output) when the key is unknown/wrong or the archive was modified or truncated. */
export async function decryptFile(archivePath: string, outPath: string, ring: KeyRing) {
  const h = readHeader(archivePath);
  const key = ring.byId.get(h.keyId);
  if (!key) throw new Error(`No key "${h.keyId}" in BACKUP_ENCRYPTION_KEYS: this archive cannot be decrypted`);
  const fd = openSync(archivePath, "r");
  const tag = Buffer.alloc(TAG);
  try { readSync(fd, tag, 0, TAG, h.size - TAG); } finally { closeSync(fd); }
  const decipher = createDecipheriv("aes-256-gcm", key, h.iv);
  decipher.setAAD(h.header);
  decipher.setAuthTag(tag);
  try {
    await pipeline(createReadStream(archivePath, { start: h.headerLen, end: h.size - TAG - 1 }), decipher, createWriteStream(outPath, { mode: 0o600 }));
  } catch {
    rmSync(outPath, { force: true });
    throw new Error("Backup archive failed authentication: wrong key, corrupted or tampered file");
  }
  return { keyId: h.keyId };
}

/** Packs every file of a backup directory into one plain container file. */
export async function packDir(dir: string, outPath: string) {
  const names = readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).sort();
  for (const n of names) if (!SAFE_NAME.test(n)) throw new Error(`Unsafe file name in backup directory: ${n}`);
  async function* parts() {
    for (const n of names) {
      const nameBuf = Buffer.from(n);
      const size = statSync(join(dir, n)).size;
      const head = Buffer.alloc(2 + nameBuf.length + 8);
      head.writeUInt16BE(nameBuf.length, 0); nameBuf.copy(head, 2); head.writeBigUInt64BE(BigInt(size), 2 + nameBuf.length);
      yield head;
      for await (const c of createReadStream(join(dir, n))) yield c as Buffer;
    }
    yield Buffer.alloc(2);
  }
  await pipeline(Readable.from(parts()), createWriteStream(outPath, { mode: 0o600 }));
}

/** Unpacks a container into `dir`; rejects unsafe names (path traversal) and truncated archives. */
export async function unpackDir(containerPath: string, dir: string) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const fh = await open(containerPath, "r");
  try {
    const total = (await fh.stat()).size;
    let pos = 0;
    const read = async (n: number) => { const b = Buffer.alloc(n); const r = await fh.read(b, 0, n, pos); if (r.bytesRead < n) throw new Error("Backup archive is truncated"); pos += n; return b; };
    const seen = new Set<string>();
    for (;;) {
      const nameLen = (await read(2)).readUInt16BE(0);
      if (nameLen === 0) break;
      const name = (await read(nameLen)).toString();
      if (!SAFE_NAME.test(name) || seen.has(name)) throw new Error(`Backup archive contains an unsafe or duplicate entry name: ${name.slice(0, 40)}`);
      seen.add(name);
      const size = Number((await read(8)).readBigUInt64BE(0));
      if (pos + size > total) throw new Error("Backup archive is truncated");
      if (size === 0) writeFileSync(join(dir, name), "", { mode: 0o600 });
      else await pipeline(createReadStream(containerPath, { start: pos, end: pos + size - 1 }), createWriteStream(join(dir, name), { mode: 0o600 }));
      pos += size;
    }
    return [...seen];
  } finally { await fh.close(); }
}
