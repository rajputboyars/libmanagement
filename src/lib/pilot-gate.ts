import type { ProfileProblem } from "./env-profile";
import type { StatusReport } from "./backup-status";
import type { SmokeCheck } from "./smoke";

/**
 * The pilot entry gate: every launch blocker as PASS, FAIL or NOT VERIFIED. Items the software can measure are checked automatically;
 * everything that needs a person or an external service is PASS only when an operator has recorded dated, named, referenced EVIDENCE
 * (docs/pilot-evidence.template.json). Evidence is operator-attested: this tool cannot prove it, and it never invents it.
 */
export type GateStatus = "PASS" | "FAIL" | "NOT VERIFIED";
export type GateItem = { id: string; label: string; status: GateStatus; detail: string; source: "automatic" | "operator evidence" };
export type Evidence = Record<string, { date?: string; by?: string; reference?: string; note?: string } | null | undefined>;

export const EVIDENCE_ITEMS: [string, string][] = [
  ["stagingDeployment", "Staging deployed from the release commit on the chosen host, smoke test passed"],
  ["backupRestoreDrill", "Real backup restored into isolated staging and verified (counts, indexes, tenants)"],
  ["atlasBackupOrPitr", "Atlas Cloud Backup/PITR enabled, or the 24-hour-RPO limitation accepted in writing"],
  ["uptimeProbes", "External uptime probes on /api/ready and /api/health active"],
  ["alertDelivery", "A real alert delivered to the on-call channel and its recovery notice received"],
  ["heartbeatMonitors", "Dead-man's-switch heartbeats (backup, deep check, worker) active; a missed ping alerts"],
  ["razorpayTestMode", "Razorpay TEST mode: real checkout, real webhook deliveries, receipt verified in the database"],
  ["paymentReconciliation", "`npm run billing:reconcile` clean against real test traffic"],
  ["exportAndClosure", "Data export and account closure exercised on staging"],
  ["rollbackRehearsed", "Rollback to the previous release rehearsed on staging"],
  ["twoPlatformAdminsEnrolled", "At least two platform admins enrolled in two-step sign-in, recovery codes stored offline"],
  ["staffTraining", "Pilot owner and staff trained, support contacts and escalation named"],
  ["pilotParticipantsAuthorized", "Each pilot library agreed in writing to take part (and to the legal terms in force)"],
];

const valid = (e: Evidence[string]) => !!e && /^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") && !!e.by?.trim() && !!e.reference?.trim();

export function evaluateGate(input: { envProblems: ProfileProblem[] | null; legalStatus: "draft" | "reviewed"; backup: StatusReport | null; smoke: SmokeCheck[] | null; evidence: Evidence }): { items: GateItem[]; ready: boolean; counts: Record<GateStatus, number> } {
  const items: GateItem[] = [];
  const add = (id: string, label: string, status: GateStatus, detail: string, source: GateItem["source"] = "automatic") => items.push({ id, label, status, detail, source });

  const envLabel = "Deployment configuration matches its profile";
  if (!input.envProblems) add("env", envLabel, "NOT VERIFIED", "run with --profile and the deployment environment loaded (npm run env:check)");
  else { const errs = input.envProblems.filter((p) => p.level === "error"); add("env", envLabel, errs.length ? "FAIL" : "PASS", errs.length ? `${errs.length} error(s): ${errs.map((e) => e.key).join(", ")}` : "no errors (configuration only; not proof that services work)"); }
  const smokeLabel = "Deployed smoke test (HTTPS, HSTS, CSP, public legal routes, signed-out API refusal, error hygiene)";
  if (!input.smoke) add("smoke", smokeLabel, "NOT VERIFIED", "no deployment URL was checked (npm run smoke -- --url ...)");
  else { const f = input.smoke.filter((c) => c.status === "fail"); add("smoke", smokeLabel, f.length ? "FAIL" : "PASS", f.length ? f.map((c) => c.name).join("; ") : `${input.smoke.filter((c) => c.status === "pass").length} checks passed, ${input.smoke.filter((c) => c.status === "skip").length} not verified`); }
  add("legal", "Privacy Notice and Terms reviewed by a lawyer; placeholders filled", input.legalStatus === "reviewed" ? "PASS" : "FAIL", input.legalStatus === "reviewed" ? "LEGAL_REVIEW_STATUS is reviewed (confirm the written review exists)" : "the texts are still an unreviewed DRAFT (docs/LEGAL_COMPLIANCE.md)");
  const backupLabel = "Off-site backup exists, is fresh and its integrity check passed";
  if (!input.backup) add("backupFresh", backupLabel, "NOT VERIFIED", "backup storage is not configured in this environment (npm run backup:status)");
  else add("backupFresh", backupLabel, input.backup.ok ? "PASS" : "FAIL", input.backup.ok ? `last successful backup ${input.backup.ageHours}h ago, integrity check recorded` : input.backup.problems.join("; "));
  for (const [id, label] of EVIDENCE_ITEMS) {
    const e = input.evidence[id];
    add(id, label, valid(e) ? "PASS" : "NOT VERIFIED", valid(e) ? `attested by ${e!.by} on ${e!.date} (${e!.reference})` : "no dated, named, referenced evidence recorded", "operator evidence");
  }
  const counts = { PASS: 0, FAIL: 0, "NOT VERIFIED": 0 } as Record<GateStatus, number>;
  for (const i of items) counts[i.status]++;
  return { items, ready: counts.FAIL === 0 && counts["NOT VERIFIED"] === 0, counts };
}
