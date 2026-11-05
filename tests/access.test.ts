import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODULES, MODULE_KEYS, dependents, isModuleKey, resolveModules } from "../src/lib/modules";
import { LEGACY_BASE, LEGACY_WORDS, NAV_ACCESS, OWNER_ONLY, PERMISSIONS, PERMISSION_KEYS, PRESET_ROLES, STUDENT_PATH_MODULE, isPermission, staffPermissions } from "../src/lib/permissions";

const everything = ["basic", "fees-expenses", "crm", "qr-attendance", "advanced-reports"];

describe("Module availability", () => {
  it("is all on when nothing is switched off and the plan has the features", () => {
    const m = resolveModules({ features: everything });
    assert.ok(MODULE_KEYS.every((k) => m[k].enabled));
  });
  it("applies platform block, plan, the library's own switch and dependencies, in that order", () => {
    const m = resolveModules({ platformBlocked: ["rewards", "crm"], libraryDisabled: ["events", "rewards", "crm"], features: ["basic"] });
    assert.deepEqual([m.rewards.reason, m.crm.reason, m.expenses.reason, m.events.reason], ["platform", "platform", "plan", "library"]);
    assert.equal(m.fees.enabled, true);
  });
  it("turns dependants off with their dependency, without storing anything", () => {
    const m = resolveModules({ libraryDisabled: ["seats"], features: everything });
    assert.deepEqual([m.memberships.reason, m.fees.reason, m.waitlist.reason], ["dependency", "dependency", "dependency"]);
    assert.equal(m.attendance.enabled, true);
    assert.deepEqual(dependents("seats").sort(), ["fees", "memberships", "waitlist"]);
    assert.deepEqual(dependents("fees"), []);
  });
  it("never lets a plan feature be switched on by the library", () => {
    const m = resolveModules({ libraryDisabled: [], features: ["basic"] });
    assert.equal(m.expenses.enabled, false);
    assert.equal(m.expenses.reason, "plan");
  });
  it("ignores unknown keys in stored lists and rejects them as module names", () => {
    const m = resolveModules({ libraryDisabled: ["ghost"], platformBlocked: ["phantom"], features: everything });
    assert.ok(MODULE_KEYS.every((k) => m[k].enabled));
    assert.equal(isModuleKey("ghost"), false);
  });
  it("only depends on modules that exist", () => {
    for (const k of MODULE_KEYS) for (const d of MODULES[k].requires) assert.ok(isModuleKey(d), `${k} -> ${d}`);
  });
});

describe("Permissions and roles", () => {
  it("every permission belongs to a real module (or to no module)", () => {
    for (const k of PERMISSION_KEYS) assert.ok(PERMISSIONS[k].module === null || isModuleKey(PERMISSIONS[k].module), k);
  });
  it("keeps billing, staff and module control out of reach of staff", () => {
    for (const k of OWNER_ONLY) assert.equal(isPermission(k), false);
  });
  it("ready-made roles use only real permissions, and none can reverse a payment", () => {
    assert.deepEqual(PRESET_ROLES.map((r) => r.name), ["Manager", "Accountant", "Receptionist", "Attendance Staff"]);
    for (const r of PRESET_ROLES) {
      assert.ok(r.permissions.every(isPermission), r.name);
      assert.ok(!r.permissions.includes("fees.reverse"), r.name);
    }
    const accountant = PRESET_ROLES.find((r) => r.key === "accountant")!;
    assert.ok(accountant.permissions.includes("fees.create") && !accountant.permissions.includes("attendance.mark"));
    const attendance = PRESET_ROLES.find((r) => r.key === "attendance")!;
    assert.ok(attendance.permissions.includes("attendance.mark") && !attendance.permissions.includes("fees.view"));
  });
  it("maps the old fixed words onto the new permissions without lockouts", () => {
    const old = staffPermissions({ legacy: ["attendance"] });
    for (const p of [...LEGACY_BASE, ...LEGACY_WORDS.attendance]) assert.ok(old.has(p), p);
    assert.ok(!old.has("fees.view") && !old.has("fees.reverse") && !old.has("memberships.create"));
    const pay = staffPermissions({ legacy: ["payments", "expenses"] });
    assert.ok(pay.has("fees.create") && pay.has("expenses.create") && !pay.has("fees.reverse"));
    assert.ok(staffPermissions({ legacy: [] }).has("seats.view"), "staff with no words keep their basic view access");
  });
  it("a role replaces the legacy words and drops unknown permissions", () => {
    const p = staffPermissions({ rolePermissions: ["fees.view", "made.up"], legacy: ["attendance", "payments"] });
    assert.deepEqual([...p], ["fees.view"]);
    assert.equal(staffPermissions({ rolePermissions: [] }).size, 0, "an empty role grants nothing");
  });
  it("menu rules point at real modules and permissions", () => {
    for (const [path, rule] of Object.entries(NAV_ACCESS)) {
      assert.ok(path.startsWith("/owner/"), path);
      if (rule.module) assert.ok(isModuleKey(rule.module), path);
      if (rule.permission) assert.ok(isPermission(rule.permission), path);
    }
    for (const m of Object.values(STUDENT_PATH_MODULE)) assert.ok(isModuleKey(m));
  });
});
