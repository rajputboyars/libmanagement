import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** TOTP (RFC 6238, HMAC-SHA1, 6 digits, 30 s) and one-time recovery codes. Pure helpers: no database, no logging. */
export const TOTP = { digits: 6, period: 30, window: 1 } as const;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Invalid base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}

/** A fresh 160-bit seed, base32 encoded (what authenticator apps expect). */
export const generateSecret = () => base32Encode(randomBytes(20));

export function hotp(secretB32: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secretB32)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 10 ** TOTP.digits).padStart(TOTP.digits, "0");
}
export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP.period);

const sameCode = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Checks a code against the current step and one step either side (clock drift).
 * Returns the matched step so the caller can refuse to accept the same step twice (replay protection).
 */
export function matchTotp(secretB32: string, code: string, now = Date.now()): number | null {
  const clean = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${TOTP.digits}}$`).test(clean)) return null;
  const current = stepAt(now);
  let hit: number | null = null;
  for (let d = -TOTP.window; d <= TOTP.window; d++) if (sameCode(hotp(secretB32, current + d), clean)) hit = current + d; // no early exit: constant work
  return hit;
}

export const otpauthUri = (secretB32: string, account: string, issuer = "StudyQuest") =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP.digits}&period=${TOTP.period}`;

// ── seed encryption at rest (AES-256-GCM, key derived from TWO_FACTOR_KEY or SESSION_SECRET) ──
function key(): Buffer {
  const material = process.env.TWO_FACTOR_KEY || process.env.SESSION_SECRET || "";
  if (material.length < 32) throw new Error("TWO_FACTOR_KEY or SESSION_SECRET must have at least 32 characters");
  return Buffer.from(hkdfSync("sha256", material, "studyquest:2fa:v1", "totp-seed", 32));
}
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}
export function decryptSecret(stored: string): string {
  const [v, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("Unsupported seed format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

// ── recovery codes: 12 characters from an unambiguous alphabet (~59 bits), shown once, stored only as salted scrypt hashes ──
const RC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const RECOVERY_COUNT = 10;
export function newRecoveryCode(): string {
  const bytes = randomBytes(12);
  let out = "";
  for (let i = 0; i < 12; i++) out += RC[bytes[i] % RC.length];
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8)}`;
}
export const normalizeRecovery = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, "");
const scryptAsync = (pw: string, salt: Buffer) => new Promise<Buffer>((res, rej) => scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k))));
export async function hashRecovery(code: string): Promise<string> {
  const salt = randomBytes(16);
  return `${salt.toString("hex")}$${(await scryptAsync(normalizeRecovery(code), salt)).toString("hex")}`;
}
/** Finds which stored hash this code matches (or null). Compares every hash so timing does not reveal the position. */
export async function findRecoveryMatch(code: string, hashes: string[]): Promise<string | null> {
  const norm = normalizeRecovery(code);
  if (norm.length !== 12) return null;
  let hit: string | null = null;
  for (const stored of hashes) {
    const [salt, hash] = stored.split("$");
    if (!salt || !hash) continue;
    const got = await scryptAsync(norm, Buffer.from(salt, "hex"));
    if (got.length === hash.length / 2 && timingSafeEqual(got, Buffer.from(hash, "hex"))) hit = stored;
  }
  return hit;
}
