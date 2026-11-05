import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { QR_TTL_SECONDS, readAttendanceToken, signAttendanceToken } from "../src/lib/attendance-token";
import { assertInside, dayKey } from "../src/lib/punch";
import { clientIp, DIRECT_IP, ipLimit } from "../src/lib/security";

const key = new TextEncoder().encode("x".repeat(40));
const lib = "64b000000000000000000001";

describe("Attendance day key", () => {
  it("uses India time, so a 01:30 IST punch belongs to that IST day", () => {
    assert.equal(dayKey(new Date("2026-03-10T20:00:00Z")), "2026-03-11"); // 01:30 IST
    assert.equal(dayKey(new Date("2026-03-10T18:29:00Z")), "2026-03-10"); // 23:59 IST
    assert.equal(dayKey(new Date("2026-03-10T18:30:00Z")), "2026-03-11"); // midnight IST
  });
  it("honours a library time zone and falls back to India for a bad one", () => {
    assert.equal(dayKey(new Date("2026-03-10T20:00:00Z"), "UTC"), "2026-03-10");
    assert.equal(dayKey(new Date("2026-03-10T20:00:00Z"), "Not/AZone"), "2026-03-11");
  });
});

describe("Desk QR code", () => {
  it("is short-lived, unique and library-bound", async () => {
    const a = await signAttendanceToken(lib, key), b = await signAttendanceToken(lib, key);
    assert.notEqual(a, b);
    const jti = await readAttendanceToken(a, key, lib);
    assert.ok(jti && jti !== (await readAttendanceToken(b, key, lib)));
    assert.ok(QR_TTL_SECONDS <= 180);
    await assert.rejects(readAttendanceToken(a, key, "64b000000000000000000002"), /not for your library/);
  });
  it("rejects expired, tampered and id-less (old style) codes", async () => {
    const old = await new SignJWT({ libraryId: lib, purpose: "attendance" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("10m").sign(key);
    await assert.rejects(readAttendanceToken(old, key, lib), /expired or is invalid/);
    const expired = await new SignJWT({ libraryId: lib, purpose: "attendance" }).setProtectedHeader({ alg: "HS256" }).setJti("j").setIssuedAt(1).setExpirationTime(2).sign(key);
    await assert.rejects(readAttendanceToken(expired, key, lib), /expired or is invalid/);
    await assert.rejects(readAttendanceToken(`${await signAttendanceToken(lib, key)}x`, key, lib), /expired or is invalid/);
    const other = await new SignJWT({ libraryId: lib, purpose: "other" }).setProtectedHeader({ alg: "HS256" }).setJti("j").setExpirationTime("1m").sign(key);
    await assert.rejects(readAttendanceToken(other, key, lib), /not for your library/);
  });
});

describe("Location rule", () => {
  const fence = { lat: 28.6139, lng: 77.209 };
  it("needs a reading once the library has set a location, and is skipped otherwise", () => {
    assert.throws(() => assertInside(fence, {}), /allow location/i);
    assert.throws(() => assertInside(fence, { lat: fence.lat + 0.002, lng: fence.lng, accuracy: 10 }), /out of geolocation/i);
    assert.doesNotThrow(() => assertInside(fence, { lat: fence.lat, lng: fence.lng, accuracy: 10 }));
    assert.doesNotThrow(() => assertInside(undefined, {}));
  });
});

describe("Rate-limit identity", () => {
  const req = (h: Record<string, string>) => new Request("http://x", { headers: h });
  const env = { ...process.env };
  const reset = () => { delete process.env.TRUST_PROXY; delete process.env.VERCEL; };
  it("never shares one bucket: unknown callers get a relaxed limit", () => {
    reset();
    assert.equal(clientIp(req({ "x-forwarded-for": "1.2.3.4" })), DIRECT_IP);
    assert.equal(ipLimit(DIRECT_IP, 20), 400);
    assert.equal(ipLimit("9.9.9.9", 20), 20);
  });
  it("trusts forwarded addresses on Vercel or TRUST_PROXY=1, unless TRUST_PROXY=0", () => {
    reset(); process.env.VERCEL = "1";
    assert.equal(clientIp(req({ "x-forwarded-for": "6.6.6.6, 9.9.9.9" })), "9.9.9.9");
    process.env.TRUST_PROXY = "0";
    assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9" })), DIRECT_IP);
    reset(); process.env.TRUST_PROXY = "1";
    assert.equal(clientIp(req({ "x-forwarded-for": "9.9.9.9" })), "9.9.9.9");
    reset(); Object.assign(process.env, env);
  });
});
