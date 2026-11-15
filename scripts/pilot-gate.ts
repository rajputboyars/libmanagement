// The pilot entry gate. PASS / FAIL / NOT VERIFIED for every launch blocker; exits 0 only when ALL are PASS.
//   npm run pilot:gate -- --profile staging|production [--url https://host] [--evidence pilot-evidence.json]
// It checks what it can (configuration, backup freshness, a deployed URL, legal status) and otherwise only accepts dated, named, referenced
// operator evidence. Running it on a developer machine will, correctly, report most items as NOT VERIFIED.
import { existsSync, readFileSync } from "node:fs";
import { LEGAL_REVIEW_STATUS } from "../src/lib/legal";
import { profileProblems, type Profile } from "../src/lib/env-profile";
import { runSmoke } from "../src/lib/smoke";
import { storeFromEnv } from "../src/lib/backup-store";
import { statusReport } from "../src/lib/backup-status";
import { evaluateGate, type Evidence } from "../src/lib/pilot-gate";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
async function main() {
  const profile = arg("profile") as Profile | undefined;
  const envProblems = profile === "staging" || profile === "production" ? profileProblems(process.env as Record<string, string | undefined>, profile, "web") : null;
  const url = arg("url");
  const smoke = url ? (await runSmoke(url, { allowHttp: false, expectLegalReviewed: false })).checks : null;
  let backup = null;
  try { backup = await statusReport(storeFromEnv()); } catch { backup = null; }
  const evidencePath = arg("evidence") ?? "pilot-evidence.json";
  const evidence: Evidence = existsSync(evidencePath) ? JSON.parse(readFileSync(evidencePath, "utf8")) : {};
  const r = evaluateGate({ envProblems, legalStatus: LEGAL_REVIEW_STATUS, backup, smoke, evidence });
  for (const i of r.items) console.log(`${i.status.padEnd(12)} ${i.label}\n             ${i.detail} [${i.source}]`);
  console.log(`\nPILOT GATE: ${r.ready ? "READY: every item is PASS" : "NOT READY"}  (${r.counts.PASS} pass, ${r.counts.FAIL} fail, ${r.counts["NOT VERIFIED"]} not verified)`);
  console.log("Entry to a pilot also requires the explicit approvals in docs/PILOT_RUNBOOK.md. This gate does not replace them.");
  process.exit(r.ready ? 0 : 1);
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
