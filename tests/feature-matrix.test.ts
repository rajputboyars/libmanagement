import { test } from "node:test";
import assert from "node:assert/strict";
import { applyFeatureSwitch, featureCell } from "../src/lib/feature-matrix";

test("feature cell explains the source", () => {
  assert.deepEqual(featureCell("crm", ["basic", "crm"], null, ["basic", "crm"]), { on: true, source: "plan" });
  assert.deepEqual(featureCell("crm", ["basic"], { features: { add: ["crm"] } }, ["basic", "crm"]), { on: true, source: "added" });
  assert.deepEqual(featureCell("crm", ["basic", "crm"], { features: { remove: ["crm"] } }, ["basic"]), { on: false, source: "removed" });
  assert.deepEqual(featureCell("crm", ["basic", "crm"], null, ["basic"]), { on: false, source: "restricted" });
  assert.deepEqual(featureCell("crm", ["basic"], null, ["basic"]), { on: false, source: "off" });
});

test("feature switch adds, removes and returns to the plan", () => {
  const on = applyFeatureSwitch({ features: { remove: ["crm"] }, reason: "x" }, "crm", "on");
  assert.deepEqual(on.features, { add: ["crm"], remove: [] });
  assert.equal(on.reason, "x");
  assert.deepEqual(applyFeatureSwitch(on, "crm", "off").features, { add: [], remove: ["crm"] });
  assert.deepEqual(applyFeatureSwitch(on, "crm", "plan").features, { add: [], remove: [] });
});
