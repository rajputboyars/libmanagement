import assert from "node:assert/strict";
import test from "node:test";
import { RECOVERY_COUNT, base32Decode, base32Encode, decryptSecret, encryptSecret, findRecoveryMatch, generateSecret, hashRecovery, hotp, matchTotp, newRecoveryCode, normalizeRecovery, otpauthUri, stepAt } from "../src/lib/two-factor";

process.env.SESSION_SECRET = "unit-test-session-secret-with-32-plus-chars";
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"

test("base32 round-trips and rejects junk", () => {
  const bytes = Uint8Array.from([0, 1, 2, 250, 255, 128, 7]);
  assert.deepEqual([...base32Decode(base32Encode(bytes))], [...bytes]);
  assert.equal(base32Encode(Buffer.from("12345678901234567890")), RFC_SECRET);
  assert.throws(() => base32Decode("not*base32"));
  assert.equal(generateSecret().length, 32);
});

test("TOTP matches the RFC 6238 test vectors (6 digits)", () => {
  assert.equal(hotp(RFC_SECRET, stepAt(59_000)), "287082");
  assert.equal(hotp(RFC_SECRET, stepAt(1_111_111_109_000)), "081804");
  assert.equal(hotp(RFC_SECRET, stepAt(1_234_567_890_000)), "005924");
});

test("matchTotp accepts one step of drift, nothing more, and only six digits", () => {
  const now = 1_234_567_890_000;
  const step = stepAt(now);
  assert.equal(matchTotp(RFC_SECRET, "005924", now), step);
  assert.equal(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now), step - 1);
  assert.equal(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now), step + 1);
  assert.equal(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now), null);
  assert.equal(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 2), now), null);
  assert.equal(matchTotp(RFC_SECRET, "12345", now), null);
  assert.equal(matchTotp(RFC_SECRET, "abcdef", now), null);
  assert.equal(matchTotp(RFC_SECRET, "00 59 24", now), step, "spaces are ignored");
});

test("seed encryption round-trips, is randomised and detects tampering", () => {
  const seed = generateSecret();
  const a = encryptSecret(seed), b = encryptSecret(seed);
  assert.notEqual(a, b);
  assert.ok(!a.includes(seed));
  assert.equal(decryptSecret(a), seed);
  const parts = a.split(".");
  parts[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => decryptSecret(parts.join(".")));
  assert.throws(() => decryptSecret("v2.x.y.z"));
});

test("recovery codes are unique, hashed with a salt and matched case/format-insensitively", async () => {
  const codes = Array.from({ length: RECOVERY_COUNT }, newRecoveryCode);
  assert.equal(new Set(codes).size, RECOVERY_COUNT);
  assert.ok(codes.every((c) => /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(c)));
  const hashes = await Promise.all(codes.map(hashRecovery));
  assert.ok(hashes.every((h, i) => !h.includes(normalizeRecovery(codes[i]))), "plaintext never stored");
  assert.notEqual((await hashRecovery(codes[0])).split("$")[1], hashes[0].split("$")[1], "same code, different salt, different hash");
  assert.equal(await findRecoveryMatch(codes[3], hashes), hashes[3]);
  assert.equal(await findRecoveryMatch(codes[3].toLowerCase().replace(/-/g, " "), hashes), hashes[3]);
  assert.equal(await findRecoveryMatch("AAAA-AAAA-AAAA", hashes), null);
  assert.equal(await findRecoveryMatch("short", hashes), null);
  assert.equal(await findRecoveryMatch(codes[0], []), null);
});

test("otpauth URI carries issuer, account and the standard parameters", () => {
  const uri = otpauthUri("ABCDEFGH", "owner@example.in");
  assert.ok(uri.startsWith("otpauth://totp/StudyQuest%3Aowner%40example.in?secret=ABCDEFGH"));
  assert.ok(uri.includes("issuer=StudyQuest") && uri.includes("digits=6") && uri.includes("period=30"));
});
