// Why a library has (or lacks) a feature: its plan, a platform-owner override, or a restriction.
import type { Overrides } from "./saas";

export type FeatureCell = { on: boolean; source: "plan" | "added" | "removed" | "off" | "restricted" };

export function featureCell(feature: string, planFeatures: string[], overrides: Overrides | null | undefined, effective: string[]): FeatureCell {
  const added = overrides?.features?.add?.includes(feature) ?? false;
  const removed = overrides?.features?.remove?.includes(feature) ?? false;
  const on = effective.includes(feature);
  if (removed) return { on: false, source: "removed" };
  if (added && on) return { on: true, source: "added" };
  if (on) return { on: true, source: "plan" };
  // In the plan but not effective means the subscription is restricted (unpaid, expired, suspended).
  return { on: false, source: planFeatures.includes(feature) ? "restricted" : "off" };
}

/** Applies one feature switch to an override: "on" adds, "off" removes, "plan" goes back to the plan. */
export function applyFeatureSwitch(overrides: Overrides | null | undefined, feature: string, mode: "on" | "off" | "plan"): Overrides {
  const add = new Set(overrides?.features?.add ?? []);
  const remove = new Set(overrides?.features?.remove ?? []);
  add.delete(feature);
  remove.delete(feature);
  if (mode === "on") add.add(feature);
  if (mode === "off") remove.add(feature);
  return { ...(overrides ?? {}), features: { add: [...add], remove: [...remove] } };
}
