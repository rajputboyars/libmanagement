import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mustRefuseToStart, profileProblems } from "../src/lib/env-profile";
import { checkEnv } from "../src/lib/env";
import { evaluateGate, EVIDENCE_ITEMS } from "../src/lib/pilot-gate";
import { runSmoke } from "../src/lib/smoke";
import { assertDemoAllowed } from "../src/lib/demo-data";

const good = (over: Record<string, string | undefined> = {}) => ({
  APP_ENV: "staging", NODE_ENV: "production", MONGODB_URI: "mongodb+srv://user:pw@cluster1.abcde.mongodb.net/studyquest_staging", SESSION_SECRET: "a".repeat(20) + "Zk9" + "b".repeat(20), TWO_FACTOR_KEY: "k".repeat(20) + "Q7x" + "m".repeat(20),
  APP_URL: "https://staging.example.in", TRUST_PROXY: "1", EMAIL_WEBHOOK_URL: "https://mail.example.in/send", ALERT_WEBHOOK_URL: "https://hooks.example.in/a",
  RAZORPAY_KEY_ID: "rzp_test_AbCdEf1234", RAZORPAY_KEY_SECRET: "keysecretkeysecret1234", RAZORPAY_WEBHOOK_SECRET: "webhooksecret-1234567", BILLING_EXPECT_MODE: "test", ...over,
}) as Record<string, string | undefined>;
const errs = (e: Record<string, string | undefined>, profile: "staging" | "production", role: "web" | "worker" | "backup" = "web") => profileProblems(e, profile, role).filter((p) => p.level === "error").map((p) => p.key).sort();

test("a complete staging configuration is valid; each missing or wrong setting is a named error", () => {
  assert.deepEqual(errs(good(), "staging"), []);
  assert.deepEqual(errs(good({ APP_ENV: "production" }), "staging"), ["APP_ENV"], "a production label on a staging deployment");
  assert.deepEqual(errs(good({ APP_ENV: undefined }), "staging"), ["APP_ENV"]);
  assert.ok(errs(good({ NODE_ENV: "development" }), "staging").includes("NODE_ENV"));
  assert.ok(errs(good({ MONGODB_URI: undefined }), "staging").includes("MONGODB_URI"));
  assert.ok(errs(good({ MONGODB_URI: "mongodb://127.0.0.1:27017/x" }), "staging").includes("MONGODB_URI"), "local database");
  assert.ok(errs(good({ MONGODB_URI: "postgres://x" }), "staging").includes("MONGODB_URI"));
  assert.ok(errs(good({ SESSION_SECRET: "short" }), "staging").includes("SESSION_SECRET"));
  assert.ok(errs(good({ SESSION_SECRET: "replace-with-a-random-secret-at-least-32-characters-long" }), "staging").includes("SESSION_SECRET"));
  assert.ok(errs(good({ TWO_FACTOR_KEY: undefined }), "staging").includes("TWO_FACTOR_KEY"), "mandatory 2FA needs its own key");
  assert.ok(errs(good({ TWO_FACTOR_KEY: good().SESSION_SECRET }), "staging").includes("TWO_FACTOR_KEY"), "must differ from the session secret");
  assert.ok(errs(good({ APP_URL: "http://staging.example.in" }), "staging").includes("APP_URL"), "https required");
  assert.ok(errs(good({ APP_URL: "https://localhost:3000" }), "staging").includes("APP_URL"));
  assert.ok(errs(good({ TRUST_PROXY: undefined }), "staging").includes("TRUST_PROXY"));
  assert.deepEqual(errs(good({ TRUST_PROXY: undefined, VERCEL: "1" }), "staging"), [], "Vercel is trusted automatically");
  assert.ok(errs(good({ EMAIL_WEBHOOK_URL: undefined }), "staging").includes("EMAIL_WEBHOOK_URL"));
  assert.ok(errs(good({ EMAIL_WEBHOOK_URL: "http://mail.example.in" }), "staging").includes("EMAIL_WEBHOOK_URL"));
  assert.ok(errs(good({ ALERT_WEBHOOK_URL: undefined }), "staging").includes("ALERT_WEBHOOK_URL"), "nobody would hear about outages");
  assert.ok(errs(good({ ALLOW_BILLING_SANDBOX: "1" }), "staging").includes("ALLOW_BILLING_SANDBOX"));
  for (const k of ["BACKUP_ENCRYPTION_KEYS", "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_SOURCE_URI"]) assert.ok(errs(good({ [k]: "x" }), "staging").includes(k), `${k} must not be on the web process`);
  assert.ok(errs(good({ BACKUP_ENCRYPTION_KEYS: "x" }), "staging", "worker").includes("BACKUP_ENCRYPTION_KEYS"));
});

test("payments: staging can only use TEST keys; production must say whether it expects live or test; test keys are never treated as live", () => {
  assert.ok(errs(good({ RAZORPAY_KEY_ID: "rzp_live_AbCdEf1234" }), "staging").includes("RAZORPAY_KEY_ID"), "a live key in staging");
  assert.ok(errs(good({ BILLING_EXPECT_MODE: "live" }), "staging").includes("BILLING_EXPECT_MODE"), "staging expecting live");
  const prod = (over: Record<string, string | undefined> = {}) => good({ APP_ENV: "production", APP_URL: "https://app.example.in", ...over });
  assert.deepEqual(errs(prod(), "production"), []);
  assert.ok(errs(prod({ BILLING_EXPECT_MODE: undefined }), "production").includes("BILLING_EXPECT_MODE"), "production must state live or test explicitly");
  assert.ok(errs(prod({ BILLING_EXPECT_MODE: "live" }), "production").includes("BILLING_EXPECT_MODE"), "test keys while live is expected");
  assert.deepEqual(errs(prod({ RAZORPAY_KEY_ID: "rzp_live_AbCdEf1234", BILLING_EXPECT_MODE: "live" }), "production"), []);
  assert.ok(errs(prod({ RAZORPAY_KEY_ID: "rzp_live_AbCdEf1234", BILLING_EXPECT_MODE: "test" }), "production").includes("BILLING_EXPECT_MODE"), "live key in a deployment that expects test");
  assert.ok(errs(prod({ RAZORPAY_API_BASE: "http://localhost:9" }), "production").includes("RAZORPAY_API_BASE"));
  const note = profileProblems(prod(), "production").find((p) => p.key === "RAZORPAY_KEY_ID");
  assert.match(note!.message, /TEST keys: payments are simulated and no real money is collected/, "production on test keys is a visible warning");
  assert.deepEqual(errs(prod({ RAZORPAY_KEY_ID: undefined, RAZORPAY_KEY_SECRET: undefined, RAZORPAY_WEBHOOK_SECRET: undefined, BILLING_EXPECT_MODE: undefined }), "production"), ["BILLING_EXPECT_MODE"].filter(() => false), "no gateway at all (free-plan pilot) is allowed with a warning");
});

test("roles: the backup job needs its own credentials; web and worker are checked differently", () => {
  const backup = { APP_ENV: "production", NODE_ENV: "production", BACKUP_SOURCE_URI: "mongodb+srv://ro:pw@c.mongodb.net/db", BACKUP_ENCRYPTION_KEYS: "k1:abc", BACKUP_S3_BUCKET: "b", BACKUP_S3_REGION: "r", BACKUP_S3_ACCESS_KEY_ID: "i", BACKUP_S3_SECRET_ACCESS_KEY: "s", ALERT_WEBHOOK_URL: "https://hooks.example.in/a", BACKUP_HEARTBEAT_URL: "https://hc.example.in/x" };
  assert.deepEqual(errs(backup, "production", "backup"), []);
  assert.ok(errs({ ...backup, BACKUP_ENCRYPTION_KEYS: undefined }, "production", "backup").includes("BACKUP_ENCRYPTION_KEYS"));
  assert.ok(errs({ ...backup, BACKUP_S3_BUCKET: undefined }, "production", "backup").includes("BACKUP_S3_BUCKET"));
  assert.ok(errs({ ...backup, BACKUP_S3_SECRET_ACCESS_KEY: undefined }, "production", "backup").includes("BACKUP_S3_SECRET_ACCESS_KEY"));
  assert.ok(errs({ ...backup, ALERT_WEBHOOK_URL: undefined }, "production", "backup").includes("ALERT_WEBHOOK_URL"));
  assert.ok(profileProblems({ ...backup, BACKUP_HEARTBEAT_URL: undefined }, "production", "backup").some((p) => p.key === "BACKUP_HEARTBEAT_URL" && p.level === "warn"));
  assert.deepEqual(errs({ APP_ENV: "staging", NODE_ENV: "production", MONGODB_URI: good().MONGODB_URI, SESSION_SECRET: good().SESSION_SECRET, ALERT_WEBHOOK_URL: good().ALERT_WEBHOOK_URL }, "staging", "worker"), [], "the worker needs no APP_URL, email or payment keys");
});

test("no profile message ever contains a secret value", () => {
  const all = JSON.stringify([good({ SESSION_SECRET: "tiny-secret-value-123", RAZORPAY_KEY_ID: "rzp_live_LeakCheck99", TWO_FACTOR_KEY: "tiny-secret-value-123", BACKUP_ENCRYPTION_KEYS: "k1:LeakCheckKey", MONGODB_URI: "mongodb://u:LeakPw@127.0.0.1/x" }), good({ TEST_STUDENT_PASSWORD: "LeakPw2", ADMIN_PASSWORD: "LeakPw3" })].flatMap((e) => profileProblems(e, "staging")));
  for (const v of ["tiny-secret-value-123", "rzp_live_LeakCheck99", "LeakCheckKey", "LeakPw", "LeakPw2", "LeakPw3", "keysecretkeysecret1234"]) assert.ok(!all.includes(v), `leaked ${v}`);
});

test("refusal to start: only with an explicit APP_ENV profile and real errors; readiness reflects the same rules", () => {
  assert.equal(mustRefuseToStart({ NODE_ENV: "production" }).refuse, false, "no APP_ENV: existing behaviour, warn only");
  assert.equal(mustRefuseToStart({ APP_ENV: "production", NODE_ENV: "production" }).refuse, true, "production profile with missing configuration refuses to start");
  assert.equal(mustRefuseToStart(good(), "web").refuse, false);
  assert.equal(mustRefuseToStart(good({ RAZORPAY_KEY_ID: "rzp_live_AbCdEf1234" }), "web").refuse, true, "live key in staging");
  assert.equal(mustRefuseToStart({ APP_ENV: "weird" }).refuse, false);
  const issues = checkEnv(good());
  assert.ok(!issues.some((i) => i.level === "error" && ["APP_ENV", "TWO_FACTOR_KEY"].includes(i.key)));
  assert.ok(checkEnv(good({ TWO_FACTOR_KEY: undefined })).some((i) => i.key === "TWO_FACTOR_KEY" && i.level === "error"), "readiness fails when the profile is violated");
  assert.ok(!checkEnv({ NODE_ENV: "production", SESSION_SECRET: "x".repeat(40), MONGODB_URI: "mongodb://x" }).some((i) => i.key === "TWO_FACTOR_KEY"), "without APP_ENV the stricter profile is not applied");
});

test("env:check CLI: exit codes, names only, no values", () => {
  const dir = mkdtempSync(join(tmpdir(), "sq-envcheck-"));
  try {
    const write = (name: string, env: Record<string, string | undefined>) => { const f = join(dir, name); writeFileSync(f, Object.entries(env).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join("\n")); return f; };
    const run = (file: string, profile: string) => { try { return { code: 0, out: execFileSync(process.execPath, ["--import", "tsx", "scripts/check-env.ts", "--profile", profile, "--env-file", file], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", SystemRoot: process.env.SystemRoot ?? "" } as unknown as NodeJS.ProcessEnv }) }; } catch (e) { const x = e as { status: number; stdout: string }; return { code: x.status, out: x.stdout }; } };
    const ok = run(write("ok.env", good()), "staging");
    assert.equal(ok.code, 0); assert.match(ok.out, /configuration is valid for staging\/web/);
    const bad = run(write("bad.env", good({ RAZORPAY_KEY_ID: "rzp_live_SecretLooking99", SESSION_SECRET: "oops" })), "staging");
    assert.equal(bad.code, 1); assert.match(bad.out, /FAIL\s+RAZORPAY_KEY_ID/); assert.match(bad.out, /NOT READY/);
    for (const v of ["rzp_live_SecretLooking99", "oops", "keysecretkeysecret1234"]) assert.ok(!bad.out.includes(v), "values are never printed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("pilot gate: nothing is PASS without evidence; evidence needs date, name and reference; a draft legal text fails", () => {
  const empty = evaluateGate({ envProblems: null, legalStatus: "draft", backup: null, smoke: null, evidence: {} });
  assert.equal(empty.ready, false);
  assert.equal(empty.items.find((i) => i.id === "legal")!.status, "FAIL");
  for (const id of ["env", "smoke", "backupFresh", ...EVIDENCE_ITEMS.map(([i]) => i)]) assert.equal(empty.items.find((i) => i.id === id)!.status, "NOT VERIFIED", id);
  const ev = { date: "2026-11-20", by: "A. Person", reference: "ticket-123" };
  const partial = evaluateGate({ envProblems: [], legalStatus: "reviewed", backup: { ok: true, now: "x", completeBackups: 3, problems: [], ageHours: 2 }, smoke: [{ name: "x", status: "pass", detail: "" }], evidence: { backupRestoreDrill: ev, uptimeProbes: { date: "2026-11-20", by: "", reference: "x" }, alertDelivery: { date: "yesterday", by: "A", reference: "x" }, razorpayTestMode: { date: "2026-11-20", by: "A" } } });
  assert.equal(partial.items.find((i) => i.id === "backupRestoreDrill")!.status, "PASS");
  for (const id of ["uptimeProbes", "alertDelivery", "razorpayTestMode"]) assert.equal(partial.items.find((i) => i.id === id)!.status, "NOT VERIFIED", `${id}: incomplete evidence does not count`);
  assert.equal(partial.ready, false);
  const failing = evaluateGate({ envProblems: [{ level: "error", key: "TWO_FACTOR_KEY", message: "x" }], legalStatus: "reviewed", backup: { ok: false, now: "x", completeBackups: 0, problems: ["No complete backup exists"] }, smoke: [{ name: "HSTS", status: "fail", detail: "" }], evidence: {} });
  assert.deepEqual(["env", "smoke", "backupFresh"].map((id) => failing.items.find((i) => i.id === id)!.status), ["FAIL", "FAIL", "FAIL"]);
  const allEvidence = Object.fromEntries(EVIDENCE_ITEMS.map(([id]) => [id, ev]));
  const everything = evaluateGate({ envProblems: [], legalStatus: "reviewed", backup: { ok: true, now: "x", completeBackups: 3, problems: [], ageHours: 2 }, smoke: [{ name: "x", status: "pass", detail: "" }], evidence: allEvidence });
  assert.equal(everything.ready, true);
});

test("smoke test detects a weak deployment: no https, no headers, stack traces, open APIs, leaky readiness", async () => {
  const server = createServer((req, res) => {
    if (req.url === "/api/ready") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ status: "ready", database: "mongodb://user:pw@host/db" })); }
    if (req.url?.startsWith("/api/definitely")) { res.writeHead(500); return res.end("Error: boom\n    at handler (C:\\app\\node_modules\\x.js:1:1)"); }
    res.writeHead(200, { "X-Powered-By": "Express" }); res.end("<html>hello</html>");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const r = await runSmoke(`http://127.0.0.1:${(server.address() as { port: number }).port}`, { allowHttp: false });
    assert.equal(r.ok, false);
    const failed = new Set(r.checks.filter((c) => c.status === "fail").map((c) => c.name));
    for (const name of ["HTTPS", "liveness /api/health", "readiness body is coarse", "CSP: nonce-based scripts, no unsafe-inline/eval", "security headers", "no X-Powered-By", "API responses allow nothing (CSP)", "legal page /privacy (signed out)", "signed-out API refused: /api/workspace", "error hygiene", "alert destination configured"]) assert.ok(failed.has(name), `detected: ${name}`);
    assert.equal(r.checks.find((c) => c.name === "session cookie flags")!.status, "skip", "no smoke account: not verified, never a pass");
    assert.equal(r.checks.find((c) => c.name === "mandatory two-step sign-in for owners/admins")!.status, "skip");
    const unreachable = await runSmoke("http://127.0.0.1:1", { allowHttp: true });
    assert.equal(unreachable.ok, false);
  } finally { server.close(); }
});

test("demo data is refused in production", () => {
  assert.throws(() => assertDemoAllowed({ APP_ENV: "production" }), /never created in a production deployment/);
  assert.doesNotThrow(() => assertDemoAllowed({ APP_ENV: "staging" }));
  assert.doesNotThrow(() => assertDemoAllowed({}));
});
