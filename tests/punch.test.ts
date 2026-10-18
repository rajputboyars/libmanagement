import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkGeofence, distanceMeters, generateLibraryCode, normalizeLibraryCode, openSession, sessionMinutes } from "../src/lib/punch";

describe("Location check (100 m)", () => {
  const lib = { lat: 28.6139, lng: 77.209 };
  // One degree of latitude is about 111,195 m, so 0.0005 degrees is about 56 m and 0.002 about 222 m.
  it("measures distance in metres", () => {
    assert.ok(Math.abs(distanceMeters(lib, { lat: lib.lat + 0.0005, lng: lib.lng }) - 55.6) < 1);
    assert.equal(Math.round(distanceMeters(lib, lib)), 0);
  });
  it("accepts a student inside 100 m and rejects one outside", () => {
    assert.equal(checkGeofence(lib, { lat: lib.lat + 0.0005, lng: lib.lng, accuracy: 20 }).ok, true);
    const far = checkGeofence(lib, { lat: lib.lat + 0.002, lng: lib.lng, accuracy: 20 });
    assert.equal(far.ok, false);
    assert.equal(!far.ok && far.reason, "outside");
  });
  it("needs a location and a reasonably accurate one", () => {
    const none = checkGeofence(lib, {});
    assert.equal(!none.ok && none.reason, "no-location");
    const vague = checkGeofence(lib, { lat: lib.lat, lng: lib.lng, accuracy: 500 });
    assert.equal(!vague.ok && vague.reason, "inaccurate");
  });
  it("treats the 100 m edge as inside and just beyond as outside", () => {
    const at = (m: number) => ({ lat: lib.lat + m / 111195, lng: lib.lng, accuracy: 10 });
    assert.equal(checkGeofence(lib, at(99)).ok, true);
    assert.equal(checkGeofence(lib, at(101)).ok, false);
  });
});

describe("Library ID", () => {
  it("is readable: LIB- plus six characters without look-alikes", () => {
    for (let i = 0; i < 200; i++) assert.match(generateLibraryCode(), /^LIB-[A-HJ-KM-NP-Z2-9]{6}$/);
  });
  it("is deterministic for a given random source and uses the whole alphabet range", () => {
    assert.equal(generateLibraryCode(() => 0), "LIB-AAAAAA");
    assert.equal(generateLibraryCode(() => 30), "LIB-999999");
  });
  it("is forgiving about case, spaces and a missing dash, and rejects malformed input", () => {
    assert.equal(normalizeLibraryCode("lib-ab12cd"), "LIB-AB12CD");
    assert.equal(normalizeLibraryCode(" lib ab12cd "), "LIB-AB12CD");
    assert.equal(normalizeLibraryCode("ab12cd"), "LIB-AB12CD");
    for (const bad of ["", "LIB-123", "LIB-ABCDEFG", "hello world", "LIB-AB 12!"]) assert.equal(normalizeLibraryCode(bad), null, bad);
  });
});

describe("Visit time", () => {
  const t = (s: string) => new Date(`2026-10-17T${s}:00Z`);
  it("sums closed sessions in minutes", () => {
    assert.equal(sessionMinutes([{ inAt: t("09:00"), outAt: t("11:30") }, { inAt: t("14:00"), outAt: t("15:00") }]), 210);
  });
  it("counts an open session up to now", () => {
    assert.equal(sessionMinutes([{ inAt: t("09:00") }], t("09:45")), 45);
  });
  it("counts auto-closed sessions as zero, never guessing a leave time", () => {
    assert.equal(sessionMinutes([{ inAt: t("09:00"), outAt: t("09:00"), auto: true }, { inAt: t("10:00"), outAt: t("10:20") }]), 20);
  });
  it("never goes negative on clock skew and finds the open session", () => {
    assert.equal(sessionMinutes([{ inAt: t("10:00"), outAt: t("09:00") }]), 0);
    assert.equal(openSession([{ inAt: t("09:00"), outAt: t("10:00") }, { inAt: t("11:00") }])?.inAt.toString(), t("11:00").toString());
    assert.equal(openSession([{ inAt: t("09:00"), outAt: t("10:00") }]), undefined);
  });
});
