import assert from "node:assert/strict";
import test from "node:test";
import { modeForWidth } from "../src/components/v2/layout";
import { MOBILE_PRIMARY_COUNT, PRIMARY_NAV, pickPrimary } from "../src/components/v2/nav-config";

type Item = [string, string, null];
const mk = (...h: string[]): Item[] => h.map((x) => [x, x, null]);

test("primary nav keeps configured order and only uses allowed items", () => {
  const nav = mk("/owner", "/owner/seats", "/owner/shifts", "/owner/plans", "/owner/settings");
  const got = pickPrimary(nav, PRIMARY_NAV.owner, MOBILE_PRIMARY_COUNT).map((n) => n[0]);
  assert.deepEqual(got, ["/owner", "/owner/seats", "/owner/shifts", "/owner/plans"]);
});

test("primary nav never invents items hidden by modules or permissions", () => {
  const nav = mk("/owner", "/owner/attendance");
  const got = pickPrimary(nav, PRIMARY_NAV.owner, MOBILE_PRIMARY_COUNT).map((n) => n[0]);
  assert.deepEqual(got, ["/owner", "/owner/attendance"]);
  assert.ok(!got.includes("/owner/fees"));
});

test("layout breakpoints", () => {
  assert.equal(modeForWidth(375), "mobile");
  assert.equal(modeForWidth(767), "mobile");
  assert.equal(modeForWidth(768), "tablet");
  assert.equal(modeForWidth(1024), "tablet");
  assert.equal(modeForWidth(1100), "desktop");
  assert.equal(modeForWidth(1440), "desktop");
});
