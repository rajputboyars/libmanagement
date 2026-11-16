// Read-only post-deployment smoke test.   npm run smoke -- --url https://staging.example.in [--allow-http] [--expect-legal-reviewed]
// Optional dedicated smoke account for cookie flags (student/staff, no two-step): SMOKE_EMAIL and SMOKE_PASSWORD in the environment.
import { runSmoke } from "../src/lib/smoke";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const url = arg("url") ?? process.env.SMOKE_URL;
if (!url) { console.error("Usage: smoke --url https://<host> [--allow-http] [--expect-legal-reviewed]"); process.exit(2); }
runSmoke(url, { allowHttp: process.argv.includes("--allow-http"), expectLegalReviewed: process.argv.includes("--expect-legal-reviewed"), smokeLogin: process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD ? { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD } : undefined }).then((r) => {
  const mark = { pass: "PASS", fail: "FAIL", warn: "warn", skip: "NOT VERIFIED" } as const;
  for (const c of r.checks) console.log(`${mark[c.status].padEnd(12)} ${c.name} — ${c.detail}`);
  const n = (s: string) => r.checks.filter((c) => c.status === s).length;
  console.log(`\nSMOKE ${r.ok ? "PASSED" : "FAILED"}: ${n("pass")} pass, ${n("fail")} fail, ${n("warn")} warning, ${n("skip")} not verified. A passing smoke test does not make a deployment production-ready.`);
  process.exit(r.ok ? 0 : 1);
});
