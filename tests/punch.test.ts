import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateLibraryCode, normalizeLibraryCode, openSession, sessionMinutes } from "../src/lib/punch";

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
