import assert from "node:assert/strict";
import test from "node:test";
import { modeForWidth } from "../src/components/v2/layout";
import { MOBILE_PRIMARY_COUNT, NAV_GROUPS, PRIMARY_NAV, groupNav, pickPrimary } from "../src/components/v2/nav-config";

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

test("groupNav only shows allowed routes, in group order, and keeps unlisted routes under Other", () => {
  const nav = mk("/owner", "/owner/payments", "/owner/students", "/owner/brand-new");
  const g = groupNav(nav, NAV_GROUPS.owner);
  assert.deepEqual(g.map((x) => x.label), ["", "People", "Money", "Other"]);
  assert.deepEqual(g.flatMap((x) => x.items.map((i) => i[0])).sort(), nav.map((n) => n[0]).sort());
  assert.ok(!g.flatMap((x) => x.items.map((i) => i[0])).includes("/owner/fees"));
});

test("groupNav without groups returns one unlabeled group", () => {
  assert.deepEqual(groupNav(mk("/a", "/b")).map((x) => [x.label, x.items.length]), [["", 2]]);
});

test("student nav is grouped separately from owner nav and keeps unlisted routes", () => {
  const nav = mk("/app", "/app/punch", "/app/membership", "/app/prep", "/app/new-thing");
  const g = groupNav(nav, NAV_GROUPS.student);
  assert.deepEqual(g.map((x) => x.label), ["", "My library", "Study", "Other"]);
  assert.ok(g.every((x) => x.items.every((i) => i[0].startsWith("/app"))));
  assert.deepEqual(pickPrimary(nav, PRIMARY_NAV.student, MOBILE_PRIMARY_COUNT).map((n) => n[0]), ["/app", "/app/punch", "/app/membership", "/app/prep"]);
});
