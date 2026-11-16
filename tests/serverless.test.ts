import assert from "node:assert/strict";
import test from "node:test";
import { defer } from "../src/lib/defer";
import { notify } from "../src/lib/alerts";
import { executeCron, heartbeatUrls, type CronDeps } from "../src/lib/cron";
import { defaultPoolSize, mongoOptions, parsePoolSize } from "../src/lib/db-config";
import { mustRefuseToStart, vercelProblems } from "../src/lib/env-profile";
import { allowedOrigins, validOrigin } from "../src/lib/auth";
import { checkEnv } from "../src/lib/env";

function capture(fn: () => void | Promise<void>) {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (l: unknown) => { lines.push(String(l)); };
  return Promise.resolve(fn()).finally(() => Object.assign(console, orig)).then(() => lines.join("\n"));
}
const tick = () => new Promise((r) => setImmediate(r));

test("defer: work is handed to the scheduler (after()), not run inline, and completes when the callback runs", async () => {
  const queued: (() => Promise<void>)[] = [];
  let done = false;
  defer(async () => { await tick(); done = true; }, { label: "test" }, (cb) => { queued.push(cb); });
  assert.equal(queued.length, 1, "scheduled");
  assert.equal(done, false, "not started before the response is finished (the callback has not run)");
  await queued[0]();
  assert.equal(done, true, "completes inside the scheduled callback (kept alive by the platform)");
});

test("defer: failures inside deferred work are caught, logged scrubbed with their label, and reported without throwing", async () => {
  const queued: (() => Promise<void>)[] = [];
  const reported: unknown[] = [];
  const out = await capture(async () => {
    defer(async () => { throw new Error("push failed for owner@example.in using mongodb://u:hunter2@h/db"); }, { label: "push-notification", onFailure: (e) => reported.push(e) }, (cb) => { queued.push(cb); });
    await assert.doesNotReject(queued[0]());
  });
  assert.match(out, /"event":"deferred.failed"/); assert.match(out, /push-notification/);
  assert.ok(!out.includes("hunter2") && !out.includes("owner@example.in"), "deferred errors are scrubbed");
  assert.equal(reported.length, 1);
  const out2 = await capture(async () => { defer(async () => { throw new Error("x"); }, { label: "t", onFailure: () => { throw new Error("reporter broke"); } }, (cb) => { queued.push(cb); }); await assert.doesNotReject(queued.at(-1)!()); });
  assert.match(out2, /deferred.failed/, "a throwing reporter cannot break the deferred work");
});

test("defer: an already-running promise that rejects early never becomes an unhandled rejection", async () => {
  const seen: unknown[] = [];
  const handler = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", handler);
  try {
    const queued: (() => Promise<void>)[] = [];
    await capture(async () => {
      defer(Promise.reject(new Error("early rejection")), { label: "early" }, (cb) => { queued.push(cb); });
      await tick(); await tick();
      await queued[0]();
    });
    await tick();
    assert.equal(seen.length, 0);
  } finally { process.off("unhandledRejection", handler); }
});

test("defer: outside a request scope the scheduler throws and the work runs immediately instead", async () => {
  let ran = false;
  defer(async () => { ran = true; }, { label: "no-request" }, () => { throw new Error("after() was called outside a request scope"); });
  await tick();
  assert.equal(ran, true);
  // the real Next.js after() is outside a request here: notify must fall back, deliver and never throw or leave an unhandled rejection
  const seen: unknown[] = [];
  const handler = (e: unknown) => seen.push(e);
  process.on("unhandledRejection", handler);
  try {
    await capture(async () => { notify(Promise.reject(new Error("alert delivery blew up"))); notify(Promise.resolve(true)); await tick(); await tick(); });
    assert.equal(seen.length, 0);
  } finally { process.off("unhandledRejection", handler); }
});

function cron(over: Partial<CronDeps> = {}) {
  const calls: string[] = [];
  const pings: (string | undefined)[] = [];
  const raised: { key: string; details?: Record<string, unknown> }[] = [];
  const resolved: { key: string; force?: boolean }[] = [];
  const rate: string[] = [];
  const deps: CronDeps = {
    authorized: true,
    connect: async () => { calls.push("connect"); },
    run: async () => { calls.push("run"); return { results: { "membership-expiry": { expired: 0 }, "weekly-reports": { sent: 1 } } }; },
    ping: async (url) => { calls.push("ping"); pings.push(url); return true; },
    alerts: {
      raise: async (key, _t, details) => { calls.push("raise"); raised.push({ key, details }); return true; },
      resolve: async (key, _d, opts) => { calls.push("resolve"); resolved.push({ key, force: opts?.force }); return true; },
      recordFailure: async (key) => { rate.push(key); return false; },
    },
    previousRunFailed: async () => false,
    recordRun: async (s) => { calls.push(`record:${s}`); },
    env: { JOBS_HEARTBEAT_URL: "https://hc.example.test/abc" },
    ...over,
  };
  return { deps, calls, pings, raised, resolved, rate };
}

test("cron: unauthorized callers get 401; nothing runs, no heartbeat, no job alert; repeated attempts are rate-alerted", async () => {
  const c = cron({ authorized: false });
  const r = await executeCron(c.deps);
  assert.equal(r.status, 401); assert.deepEqual(r.body, { error: "Unauthorized" });
  assert.deepEqual(c.calls, [], "no connect, no run, no ping, no alert");
  assert.deepEqual(c.rate, ["cron.unauthorized"]);
});

test("cron: success heartbeat is sent only after every job has finished successfully", async () => {
  const c = cron();
  const r = await executeCron(c.deps);
  assert.equal(r.status, 200); assert.equal(r.body.ok, true);
  assert.deepEqual(c.calls, ["connect", "run", "record:ok", "ping"], "ping is the very last step, after the run completed");
  assert.deepEqual(c.pings, ["https://hc.example.test/abc"]);
  assert.equal(c.raised.length, 0);
});

test("cron: a failed job raises an alert, sends the FAILURE heartbeat only, and answers 500", async () => {
  const c = cron({ run: async () => ({ results: { "membership-expiry": { expired: 3 }, "billing-reconciliation": { error: "gateway timeout" }, "weekly-reports": { sent: 0 } } }) });
  const r = await executeCron(c.deps);
  assert.equal(r.status, 500); assert.deepEqual(r.body, { ok: false, failed: ["billing-reconciliation"] });
  assert.deepEqual(c.raised.map((x) => x.key), ["cron.failed"]);
  assert.deepEqual(c.raised[0].details?.failedJobs, ["billing-reconciliation"]);
  assert.deepEqual(c.pings, ["https://hc.example.test/abc/fail"], "no success heartbeat for a failed run");
  assert.ok(c.calls.includes("record:failed") && !c.calls.includes("record:ok"));
});

test("cron: an unexpected exception (database down, run throws) is alerted, scrubbed, answered 500 with no internals", async () => {
  for (const which of ["connect", "run"] as const) {
    const boom = async () => { throw new Error("connect ECONNREFUSED mongodb://admin:hunter2@cluster0.x.mongodb.net/db"); };
    const c = cron(which === "connect" ? { connect: boom } : { run: boom });
    const r = await executeCron(c.deps);
    assert.equal(r.status, 500); assert.deepEqual(r.body, { ok: false, error: "Scheduled jobs failed" });
    assert.deepEqual(c.raised.map((x) => x.key), ["cron.failed"]);
    assert.ok(!JSON.stringify(c.raised).includes("hunter2"), "alert details are scrubbed");
    assert.deepEqual(c.pings, ["https://hc.example.test/abc/fail"]);
  }
});

test("cron: a run skipped because another run holds the lock sends no heartbeat and no alert (no duplicate execution)", async () => {
  const c = cron({ run: async () => ({ results: {}, skipped: "another run is in progress" }) });
  const r = await executeCron(c.deps);
  assert.deepEqual([r.status, r.body], [200, { ok: true, skipped: true }]);
  assert.deepEqual(c.calls, ["connect"], "no run record, no ping, no alert");
  assert.equal(c.raised.length, 0);
});

test("cron: recovery notice after a failed previous run; heartbeat/alert problems never change the outcome; URL configuration", async () => {
  const c = cron({ previousRunFailed: async () => true });
  await executeCron(c.deps);
  assert.deepEqual(c.resolved, [{ key: "cron.failed", force: true }], "a fresh serverless instance sends the recovery notice from persisted state");
  const broken = cron({ ping: async () => false });
  assert.equal((await executeCron(broken.deps)).status, 200, "a failing heartbeat endpoint does not fail the jobs");
  const noUrl = cron({ env: {} });
  assert.equal((await executeCron(noUrl.deps)).status, 200); assert.deepEqual(noUrl.pings, [undefined], "no URL configured: ping receives undefined (no-op)");
  assert.deepEqual(heartbeatUrls({ JOBS_HEARTBEAT_URL: "https://h/x/" }), { ok: "https://h/x/", fail: "https://h/x/fail" });
  assert.deepEqual(heartbeatUrls({ WORKER_HEARTBEAT_URL: "https://h/w" }), { ok: "https://h/w", fail: "https://h/w/fail" }, "falls back to the worker heartbeat variable");
  assert.deepEqual(heartbeatUrls({ JOBS_HEARTBEAT_URL: "https://h/a", JOBS_HEARTBEAT_FAIL_URL: "https://h/f" }), { ok: "https://h/a", fail: "https://h/f" });
  const throwingAlerts = cron({ alerts: { raise: async () => { throw new Error("alert backend down"); }, resolve: async () => false, recordFailure: async () => false }, run: async () => { throw new Error("x"); } });
  assert.equal((await executeCron(throwingAlerts.deps)).status, 500, "even a broken alert manager yields a clean 500");
});

test("MongoDB pool size: validated, conservative on Vercel, never throws", () => {
  assert.deepEqual(parsePoolSize({}), { size: 20, source: "default" });
  assert.deepEqual(parsePoolSize({ VERCEL: "1" }), { size: 5, source: "default" }, "conservative serverless default");
  assert.equal(defaultPoolSize({ VERCEL: "1" }), 5); assert.equal(defaultPoolSize({ VERCEL: "0" }), 20);
  assert.deepEqual(parsePoolSize({ MONGODB_POOL_SIZE: "8", VERCEL: "1" }), { size: 8, source: "env" });
  assert.deepEqual(parsePoolSize({ MONGODB_POOL_SIZE: " 12 " }), { size: 12, source: "env" });
  assert.equal(parsePoolSize({ MONGODB_POOL_SIZE: "1" }).size, 1); assert.equal(parsePoolSize({ MONGODB_POOL_SIZE: "100" }).size, 100);
  for (const bad of ["0", "101", "-3", "2.5", "abc", "1e3", "NaN", "5 connections", "0x10"]) {
    const r = parsePoolSize({ MONGODB_POOL_SIZE: bad, VERCEL: "1" });
    assert.deepEqual([r.size, r.source], [5, "default"], `${bad}: default used`);
    assert.ok(r.invalid, `${bad}: reported`);
  }
  assert.deepEqual(parsePoolSize({ MONGODB_POOL_SIZE: "" }), { size: 20, source: "default" });
  const vercel = mongoOptions({ VERCEL: "1" });
  assert.deepEqual([vercel.maxPoolSize, vercel.minPoolSize, vercel.maxIdleTimeMS, vercel.serverSelectionTimeoutMS], [5, 0, 30000, 8000]);
  assert.equal(mongoOptions({}).maxPoolSize, 20); assert.ok(!("maxIdleTimeMS" in mongoOptions({})));
  assert.ok(checkEnv({ NODE_ENV: "production", MONGODB_POOL_SIZE: "abc", SESSION_SECRET: "x".repeat(40), MONGODB_URI: "mongodb://x" }).some((i) => i.key === "MONGODB_POOL_SIZE" && i.level === "warn"), "a bad value is reported in readiness as a warning");
});

const base = { NODE_ENV: "production", MONGODB_URI: "mongodb+srv://u:pw@staging.abcde.mongodb.net/studyquest_staging", SESSION_SECRET: "s".repeat(40) };
test("Vercel environment separation: Preview can never be labelled production, use a protected database or a live payment key", () => {
  const errs = (env: Record<string, string | undefined>) => vercelProblems(env).filter((p) => p.level === "error").map((p) => p.key).sort();
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "preview", APP_ENV: "staging", PROTECTED_DB_TARGETS: "cluster0.abcde.mongodb.net/studyquest" }), []);
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "preview", APP_ENV: "production" }), ["APP_ENV"]);
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "preview", RAZORPAY_KEY_ID: "rzp_live_AbCdEf1234" }), ["RAZORPAY_KEY_ID"]);
  const prodUri = "mongodb+srv://prod:pw@cluster0.abcde.mongodb.net/studyquest";
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "preview", MONGODB_URI: prodUri, PROTECTED_DB_TARGETS: "cluster0.abcde.mongodb.net/studyquest" }), ["MONGODB_URI"], "production credentials in Preview");
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "preview", MONGODB_URI: "mongodb+srv://other:x@CLUSTER0.abcde.mongodb.net/studyquest", PROTECTED_DB_TARGETS: prodUri }), ["MONGODB_URI"], "URI form, different credentials and case");
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "preview", MONGODB_URI: "mongodb+srv://u:x@cluster0.abcde.mongodb.net/studyquest_preview", PROTECTED_DB_TARGETS: "cluster0.abcde.mongodb.net/studyquest" }), [], "same cluster but a different database name is not the protected database");
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "preview", MONGODB_URI: "mongodb+srv://u:x@cluster0.abcde.mongodb.net/anything", PROTECTED_DB_TARGETS: "cluster0.abcde.mongodb.net" }), ["MONGODB_URI"], "a protected host with no database name protects the whole cluster");
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "production" }), ["APP_ENV"], "a Production deployment must be labelled production");
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "production", APP_ENV: "production" }), []);
  assert.deepEqual(errs({ ...base, VERCEL_ENV: "development" }), []);
  assert.deepEqual(errs(base), [], "outside Vercel nothing changes");
  const warn = vercelProblems({ ...base, VERCEL_ENV: "preview" }).filter((p) => p.level === "warn").map((p) => p.key);
  assert.deepEqual(warn.sort(), ["APP_ENV", "PROTECTED_DB_TARGETS"], "unlabelled previews are warned");
  const all = JSON.stringify(vercelProblems({ ...base, VERCEL_ENV: "preview", MONGODB_URI: prodUri, PROTECTED_DB_TARGETS: prodUri, RAZORPAY_KEY_ID: "rzp_live_LeakCheck99" }));
  for (const v of ["pw", "rzp_live_LeakCheck99", "prod:pw"]) assert.ok(!all.includes(`${v}@`) && !all.includes("LeakCheck99"), "no values in messages");
  // the guard applies even without an APP_ENV profile, so mis-scoped Preview deployments refuse to start
  assert.equal(mustRefuseToStart({ ...base, VERCEL_ENV: "preview", MONGODB_URI: prodUri, PROTECTED_DB_TARGETS: "cluster0.abcde.mongodb.net/studyquest" }).refuse, true);
  assert.equal(mustRefuseToStart({ ...base, VERCEL_ENV: "preview", APP_ENV: "production" }).refuse, true);
  assert.equal(mustRefuseToStart({ ...base, VERCEL_ENV: "preview" }).refuse, false, "a correctly separated Preview without a profile still starts (with warnings)");
  assert.equal(mustRefuseToStart({ ...base, VERCEL_ENV: "production" }).refuse, true);
  assert.ok(checkEnv({ ...base, VERCEL_ENV: "preview", APP_ENV: "production" }).some((i) => i.key === "APP_ENV" && i.level === "error"), "readiness fails too");
});

const req = (origin: string | null, extra: Record<string, string> = {}) => new Request("https://studyquest.example.in/api/consent", { method: "POST", headers: { host: "studyquest.example.in", ...(origin ? { origin } : {}), ...extra } });
test("origin (CSRF) validation: production stays strict; only a Preview deployment also accepts its own deployment URL", () => {
  const prod = { APP_URL: "https://app.example.in", VERCEL_ENV: "production", VERCEL_URL: "studyquest-git-v2-acme.vercel.app" };
  assert.equal(validOrigin(req("https://app.example.in"), prod), true);
  assert.equal(validOrigin(req("https://studyquest-git-v2-acme.vercel.app"), prod), false, "Production never trusts a *.vercel.app deployment origin, even though VERCEL_URL is set");
  assert.equal(validOrigin(req("https://evil.example"), prod), false);
  assert.equal(validOrigin(req("http://app.example.in"), prod), false, "scheme must match");
  assert.deepEqual(allowedOrigins(req(null), prod), ["https://app.example.in"]);
  const preview = { APP_URL: "https://staging.example.in", VERCEL_ENV: "preview", VERCEL_URL: "studyquest-abc123-acme.vercel.app", VERCEL_BRANCH_URL: "studyquest-git-v2-acme.vercel.app" };
  assert.equal(validOrigin(req("https://studyquest-abc123-acme.vercel.app"), preview), true);
  assert.equal(validOrigin(req("https://studyquest-git-v2-acme.vercel.app"), preview), true);
  assert.equal(validOrigin(req("https://staging.example.in"), preview), true);
  assert.equal(validOrigin(req("https://app.example.in"), preview), false, "a Preview deployment does not accept the production origin");
  assert.equal(validOrigin(req("https://other-project.vercel.app"), preview), false, "other deployments are never trusted");
  assert.equal(validOrigin(req("https://studyquest-abc123-acme.vercel.app.evil.example"), preview), false);
  assert.deepEqual(allowedOrigins(req(null), { ...preview, VERCEL_URL: "bad host/../" }), ["https://staging.example.in", "https://studyquest-git-v2-acme.vercel.app"], "malformed platform values are ignored");
  // unchanged behaviour outside Vercel
  assert.equal(validOrigin(req("https://studyquest.example.in"), {}), true, "no APP_URL: the request host");
  assert.equal(validOrigin(req(null), {}), true); assert.equal(validOrigin(req(null, { "sec-fetch-site": "cross-site" }), {}), false);
});
