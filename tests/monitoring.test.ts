import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { log, redact, scrubText, serializeError, withRequestId } from "../src/lib/log";
import { createAlertManager, ping } from "../src/lib/alerts";
import { isUnexpected, reportUnexpected } from "../src/lib/api-errors";
import { installProcessHandlers } from "../src/lib/process-monitor";
import { DirStore } from "../src/lib/backup-store";
import { readStatus, statusReport, writeStatus } from "../src/lib/backup-status";

const NOW = new Date("2026-11-15T12:00:00Z").getTime();
const SECRETS = ["hunter2-password", "s3cr3tCookieValue", "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", "ABCD-EFGH-JKLM", "4111111111111111", "owner@example.in", "9876543210", "rzp_live_AbCdEf123456"];

function capture(fn: () => void) {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = console.warn = console.error = (l: unknown) => { lines.push(String(l)); };
  try { fn(); } finally { Object.assign(console, orig); }
  return lines.join("\n");
}

test("logs carry severity, timestamp, environment and request id, and never throw", () => {
  const out = capture(() => log("error", "test.event", { route: "/api/x" }));
  const line = JSON.parse(out);
  assert.equal(line.level, "error"); assert.equal(line.event, "test.event"); assert.equal(line.service, "studyquest");
  assert.ok(!Number.isNaN(Date.parse(line.ts)));
  const withId = JSON.parse(capture(() => withRequestId("req-12345678", () => log("warn", "with.id"))));
  assert.equal(withId.requestId, "req-12345678"); assert.equal(withId.level, "warn");
  assert.equal(withId.env, process.env.NODE_ENV);
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.doesNotThrow(() => capture(() => log("error", "circular", circular)));
  const big = BigInt(1);
  assert.doesNotThrow(() => capture(() => log("error", "bigint", { big })));
});

test("scrubbing: passwords, cookies, auth headers, tokens, TOTP seeds, recovery codes, database URIs and payment data never reach logs", () => {
  const err = new Error("connect failed mongodb+srv://admin:p%40ssw0rd@cluster0.abc.mongodb.net/studyquest?retryWrites=true for owner@example.in");
  const out = capture(() => log("error", "api.unexpected_error", {
    password: "hunter2-password", currentPassword: "hunter2-password", cookie: "sq-session=s3cr3tCookieValue", authorization: "Bearer abc.def.ghi",
    totpSecret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP", recoveryCodes: ["ABCD-EFGH-JKLM"], MONGODB_URI: "mongodb://u:pw@10.0.0.5:27017/db",
    cardNumber: "4111111111111111", nested: { deeper: { note: "call 9876543210 or mail owner@example.in", header: "cookie: sq-session=s3cr3tCookieValue; theme=dark" } },
    razorpay: "rzp_live_AbCdEf123456", error: err, free: "code ABCD-EFGH-JKLM and seed JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
  }));
  for (const secret of [...SECRETS, "p%40ssw0rd", "cluster0.abc.mongodb.net", "10.0.0.5", "abc.def.ghi"]) assert.ok(!out.includes(secret), `leaked: ${secret}`);
  assert.ok(out.includes("[db-uri]") || out.includes("[redacted]"));
  assert.ok(JSON.parse(out).error.stack, "stack frames stay in server logs (scrubbed)");
  assert.equal(scrubText("sq-session=abcdef; token=xyz"), "sq-session=[redacted]; token=[redacted]");
  assert.deepEqual(redact({ a: 1, b: [1, 2], ok: "plain text" }), { a: 1, b: [1, 2], ok: "plain text" });
  const long = scrubText("x ".repeat(400));
  assert.ok(long.length <= 501);
  const s = serializeError(Object.assign(new Error("boom"), { digest: "123", code: 11000 }));
  assert.equal(s.digest, "123"); assert.equal(s.code, 11000);
});

function manager(over: Partial<Parameters<typeof createAlertManager>[0]> = {}) {
  const sent: { url: string; body: Record<string, unknown> & { key?: string; status?: string; text?: string; severity?: string; runbook?: string; details?: Record<string, unknown> } }[] = [];
  let t = NOW;
  const m = createAlertManager({
    now: () => t, url: () => "https://hooks.example.test/alert", environment: () => "production",
    fetch: (async (url: string, init: { body: string }) => { sent.push({ url, body: JSON.parse(init.body) }); return new Response("ok", { status: 200 }); }) as never,
    ...over,
  });
  return { m, sent, advance: (ms: number) => { t += ms; }, set: (v: number) => { t = v; } };
}

test("alerts: first occurrence is sent with actionable, scrubbed context; repeats are deduplicated until the cooldown ends", async () => {
  const { m, sent, advance } = manager();
  assert.equal(await m.raise("backup.failed", "Database backup FAILED", { message: "see log", password: "hunter2-password", uri: "mongodb://u:pw@h/db" }, { severity: "critical" }), true);
  assert.equal(sent.length, 1);
  const b = sent[0].body;
  assert.equal(b.status, "firing"); assert.equal(b.severity, "critical"); assert.equal(b.key, "backup.failed");
  assert.match(String(b.text), /\[StudyQuest:production\] CRITICAL: Database backup FAILED/);
  assert.match(String(b.runbook), /docs\/MONITORING.md#alert-backup/);
  assert.ok(!JSON.stringify(b).includes("hunter2") && !JSON.stringify(b).includes("u:pw@"));
  for (let i = 0; i < 5; i++) { advance(60_000); assert.equal(await m.raise("backup.failed", "Database backup FAILED"), false); }
  assert.equal(sent.length, 1, "deduplicated inside the cooldown");
  advance(15 * 60_000);
  assert.equal(await m.raise("backup.failed", "Database backup FAILED"), true);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body.suppressedSinceLast, 5, "the next notice says how many were suppressed");
  assert.equal(await m.raise("other.problem", "Something else"), true, "different keys are independent");
});

test("alerts: recovery notice is sent once, only for a firing alert, and can be forced from persisted state", async () => {
  const { m, sent, advance } = manager();
  assert.equal(await m.resolve("db.unavailable"), false, "nothing firing, nothing to resolve");
  await m.raise("db.unavailable", "Database is unreachable");
  advance(5 * 60_000);
  assert.equal(await m.resolve("db.unavailable", { ms: 12 }), true);
  assert.equal(sent.at(-1)!.body.status, "resolved");
  assert.match(String(sent.at(-1)!.body.text), /RESOLVED/);
  assert.equal(sent.at(-1)!.body.outageMs, 300000);
  assert.equal(await m.resolve("db.unavailable"), false, "only once");
  assert.equal(await m.resolve("backup.failed", {}, { force: true, title: "Database backup FAILED" }), true, "a later process recovers an earlier process's alert");
  assert.equal(await m.raise("db.unavailable", "Database is unreachable"), true, "a new outage alerts again");
});

test("alerts: storm protection caps notifications and reports how many were held back", async () => {
  const { m, sent, advance } = manager({ maxPerWindow: 3, windowMs: 10 * 60_000 });
  const results: boolean[] = [];
  for (let i = 0; i < 8; i++) results.push(await m.raise(`flood.${i}`, `Flood ${i}`));
  assert.deepEqual(results.filter(Boolean).length, 3);
  assert.equal(sent.length, 3);
  advance(11 * 60_000);
  assert.equal(await m.raise("flood.99", "After the window"), true);
  assert.equal(sent.at(-1)!.body.otherAlertsSuppressed, 5);
});

test("alerts: delivery failures (down, 500, hanging, bad URL) never throw and never block the caller", async () => {
  const down = manager({ fetch: (async () => { throw new Error("connect ECONNREFUSED 10.1.2.3:443 mongodb://u:pw@h/db"); }) as never });
  assert.equal(await down.m.raise("x", "X"), false);
  assert.equal(down.m.stats().deliveryFailures, 1);
  assert.ok(!String(down.m.stats().lastDeliveryError).includes("u:pw@"), "failure reason is scrubbed");
  const five = manager({ fetch: (async () => new Response("no", { status: 500 })) as never });
  assert.equal(await five.m.raise("x", "X"), false);
  const t0 = Date.now();
  const hang = manager({ timeoutMs: 80, fetch: ((_u: string, init: { signal: AbortSignal }) => new Promise((_r, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))))) as never });
  assert.equal(await hang.m.raise("x", "X"), false);
  assert.ok(Date.now() - t0 < 2000, "a hanging webhook is cut off by the timeout");
  const none = manager({ url: () => undefined });
  assert.equal(await none.m.raise("x", "X"), false);
  assert.equal(none.sent.length, 0, "no destination configured: nothing is claimed as sent");
  const http = manager({ url: () => "http://hooks.example.test/alert" });
  assert.equal(await http.m.raise("x", "X"), false, "plain http is refused in production");
  assert.equal(http.sent.length, 0);
  const dev = manager({ url: () => "http://127.0.0.1:9/alert", environment: () => "development" });
  assert.equal(await dev.m.raise("x", "X"), true, "plain http is allowed in development");
  const throwingClaim = manager({ claim: async () => { throw new Error("db down"); } });
  assert.equal(await throwingClaim.m.raise("x", "X"), true, "the shared claim fails open");
});

test("alerts: another instance's claim suppresses duplicates across instances", async () => {
  const taken = new Set<string>();
  const claim = async (key: string) => { if (taken.has(key)) return false; taken.add(key); return true; };
  const a = manager({ claim }), b = manager({ claim });
  assert.equal(await a.m.raise("db.unavailable", "DB"), true);
  assert.equal(await b.m.raise("db.unavailable", "DB"), false);
  assert.equal(b.sent.length, 0);
});

test("alerts: repeated failures raise a rate alert only past the threshold and recover after calm", async () => {
  const { m, sent, advance } = manager();
  for (let i = 0; i < 9; i++) assert.equal(await m.recordFailure("api.error-rate", { title: "API error rate is high", threshold: 10, windowMs: 5 * 60_000 }), false);
  assert.equal(sent.length, 0);
  assert.equal(await m.recordFailure("api.error-rate", { title: "API error rate is high", threshold: 10, windowMs: 5 * 60_000 }), true);
  assert.equal(sent[0].body.details?.failuresInWindow, 10);
  await m.sweep();
  assert.equal(sent.length, 1, "still failing: no recovery yet");
  advance(6 * 60_000);
  await m.sweep();
  assert.equal(sent.at(-1)!.body.status, "resolved");
});

test("error classification: infrastructure and programming errors alert, business errors do not", () => {
  const named = (name: string, msg = "x", extra: object = {}) => Object.assign(new Error(msg), { name }, extra);
  for (const e of [named("MongoServerSelectionError"), named("MongoNetworkError"), named("MongooseServerSelectionError"), named("MongoServerError", "x", { code: 13 }), new TypeError("cannot read"), new Error("Operation `users.find()` buffering timed out after 10000ms"), "string thrown"]) assert.equal(isUnexpected(e), true, String(e));
  for (const e of [named("ZodError"), named("PlanError"), named("AccessError"), named("CastError"), named("MongoServerError", "dup", { code: 11000 }), new Error("That seat is already taken"), named("MongoServerError", "t", { code: 112, errorLabels: ["TransientTransactionError"] })]) assert.equal(isUnexpected(e), false, String((e as Error).name));
  const out = capture(() => { reportUnexpected(new Error("business message"), "/api/fees"); });
  assert.equal(out, "", "business errors are not logged as unexpected");
  const err = new TypeError("boom mongodb://u:pw@h/db");
  const logged = capture(() => { reportUnexpected(err, "/api/fees"); reportUnexpected(err, "/api/fees"); });
  assert.equal(logged.split("\n").filter((l) => l.includes("api.unexpected_error")).length, 1, "one report per error object");
  assert.ok(!logged.includes("u:pw@"));
  assert.doesNotThrow(() => capture(() => reportUnexpected(undefined, "/api/x")));
});

test("process handlers are opt-in outside production", () => {
  assert.equal(installProcessHandlers("test"), false);
});

test("heartbeat ping never throws and reports success only for 2xx", async () => {
  assert.equal(await ping(undefined), false);
  assert.equal(await ping("https://hc.example.test/abc", { fetch: (async () => new Response("", { status: 200 })) as never }), true);
  assert.equal(await ping("https://hc.example.test/abc", { fetch: (async () => new Response("", { status: 500 })) as never }), false);
  assert.equal(await ping("https://hc.example.test/abc", { fetch: (async () => { throw new Error("down"); }) as never }), false);
});

test("backup status report: last successful backup, integrity check state, stale and failed states", async () => {
  const root = mkdtempSync(join(tmpdir(), "sq-mon-"));
  const now = new Date("2026-11-15T12:00:00Z");
  const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  try {
    const store = new DirStore(join(root, "s"));
    const empty = await statusReport(store, { now });
    assert.equal(empty.ok, false); assert.match(empty.problems.join(), /No complete backup/);
    const put = async (name: string, content: string) => { writeFileSync(join(root, "tmp"), content); await store.put(name, join(root, "tmp")); };
    const at = new Date(now.getTime() - 3 * 3600_000);
    const name = `studyquest-db-${stamp(at)}.sqbak`;
    await put(name, "archive"); await put(`${name}.json`, "{}");
    const noCheck = await statusReport(store, { now });
    assert.equal(noCheck.lastSuccessfulBackupAt, at.toISOString()); assert.equal(noCheck.ageHours, 3);
    assert.match(noCheck.problems.join(), /No integrity check/);
    await writeStatus(store, { lastCheck: { at: now.toISOString(), ok: true, deep: true, problems: [] } });
    const good = await statusReport(store, { now });
    assert.equal(good.ok, true, JSON.stringify(good)); assert.equal(good.lastIntegrityCheck?.deep, true);
    await writeStatus(store, { lastCheck: { at: now.toISOString(), ok: false, deep: true, problems: ["checksum mismatch"] } }, await readStatus(store));
    assert.match((await statusReport(store, { now })).problems.join(), /integrity check FAILED: checksum mismatch/);
    await writeStatus(store, { lastCheck: { at: new Date(now.getTime() - 9 * 86400_000).toISOString(), ok: true, deep: true, problems: [] } }, await readStatus(store));
    assert.match((await statusReport(store, { now })).problems.join(), /older than 8 days/);
    const stale = await statusReport(store, { now: new Date(now.getTime() + 40 * 3600_000) });
    assert.match(stale.problems.join(), /Last successful backup is 43h old/);
    const broken = { put: async () => { throw new Error("store down"); }, list: store.list.bind(store), get: store.get.bind(store), remove: store.remove.bind(store), kind: "x", label: "x" };
    assert.equal(await writeStatus(broken as never, {}), false, "status write failures are reported to the caller, not thrown");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
