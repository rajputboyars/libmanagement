import { after, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { MongoMemoryServer } from "mongodb-memory-server";
import mongoose from "mongoose";
import { emailConfigured, sendEmail } from "../src/lib/saas-notify";

// Fake email provider: records every request and answers with the queued statuses (default 200).
type Sent = { url: string; headers: Record<string, string>; body: { to: string; subject: string; text: string } };
const sent: Sent[] = [];
let replies: (number | "network")[] = [];
const realFetch = globalThis.fetch;
const env = process.env as Record<string, string | undefined>;
const setEnv = (values: Record<string, string | undefined>) => { for (const [k, v] of Object.entries(values)) if (v === undefined) delete env[k]; else env[k] = v; };

beforeEach(() => {
  sent.length = 0; replies = [];
  setEnv({ NODE_ENV: "test", EMAIL_WEBHOOK_URL: "https://mail.example.invalid/send", EMAIL_WEBHOOK_TOKEN: "test-token" });
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const reply = replies.shift() ?? 200;
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
    if (reply === "network") throw new TypeError("fetch failed");
    return new Response("{}", { status: reply });
  }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; });

describe("sendEmail", () => {
  it("delivers through the webhook with auth and idempotency headers", async () => {
    assert.equal(await sendEmail("a@example.invalid", "Hi", "Body"), "accepted");
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body, { to: "a@example.invalid", subject: "Hi", text: "Body" });
    assert.equal(sent[0].headers.Authorization, "Bearer test-token");
    assert.ok(sent[0].headers["Idempotency-Key"]);
  });
  it("reports missing configuration without calling anything", async () => {
    setEnv({ EMAIL_WEBHOOK_URL: undefined });
    assert.equal(await sendEmail("a@example.invalid", "Hi", "Body"), "not-configured");
    assert.equal(sent.length, 0);
  });
  it("refuses a plain-http endpoint in production", async () => {
    assert.equal(emailConfigured({ NODE_ENV: "production", EMAIL_WEBHOOK_URL: "http://mail.example.invalid" } as NodeJS.ProcessEnv), false);
    assert.equal(emailConfigured({ NODE_ENV: "production", EMAIL_WEBHOOK_URL: "https://mail.example.invalid" } as NodeJS.ProcessEnv), true);
  });
  it("retries once on 5xx or network errors with the same idempotency key", async () => {
    replies = [503, 200];
    assert.equal(await sendEmail("a@example.invalid", "Hi", "Body"), "accepted");
    assert.equal(sent.length, 2);
    assert.equal(sent[0].headers["Idempotency-Key"], sent[1].headers["Idempotency-Key"]);
    replies = ["network", "network"];
    assert.equal(await sendEmail("a@example.invalid", "Hi", "Body"), "failed");
  });
  it("does not retry a rejected request (4xx) and reports failure", async () => {
    replies = [400];
    assert.equal(await sendEmail("a@example.invalid", "Hi", "Body"), "failed");
    assert.equal(sent.length, 1);
  });
});

describe("Password reset email flow", () => {
  let server: MongoMemoryServer;
  let handle: typeof import("../src/lib/auth-extra").handleAuthExtra;
  let models: typeof import("../src/lib/models");
  let ops: typeof import("../src/lib/ops-models");
  const email = "owner@example.invalid";
  const call = (action: string, body: object) => handle(action, new Request(`http://localhost/api/auth/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  const tokenFromMail = () => new URL(sent[sent.length - 1].body.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

  before(async () => {
    server = await MongoMemoryServer.create({ binary: { version: "7.0.14" } });
    setEnv({ MONGODB_URI: server.getUri(), SESSION_SECRET: "k9Zq2vX7mP4tR8wB1nC6yL3hD5gJ0sAe", APP_URL: "https://app.example.invalid" });
    ({ handleAuthExtra: handle } = await import("../src/lib/auth-extra"));
    models = await import("../src/lib/models");
    ops = await import("../src/lib/ops-models");
    const { db } = await import("../src/lib/db");
    await db();
    await models.User.create({ name: "Owner", email, passwordHash: "x", role: "owner" });
  });
  beforeEach(async () => { await mongoose.connection.collection("ratelimits").deleteMany({}).catch(() => null); });
  after(async () => { await mongoose.disconnect(); await server?.stop(); });

  it("emails a single-use link that resets the password once", async () => {
    const res = await call("forgot", { email });
    assert.equal(res!.status, 200);
    assert.equal(sent.length, 1);
    const token = tokenFromMail();
    assert.equal((await call("reset", { token, password: "a-new-password-1" }))!.status, 200);
    const again = await call("reset", { token, password: "another-password-2" });
    assert.equal(again!.status, 400, "a used token cannot be reused");
  });
  it("rejects invalid and expired tokens", async () => {
    assert.equal((await call("reset", { token: "x".repeat(40), password: "a-new-password-1" }))!.status, 400);
    await call("forgot", { email });
    const token = tokenFromMail();
    await ops.PasswordReset.updateMany({}, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await call("reset", { token, password: "a-new-password-1" }))!.status, 400);
  });
  it("gives unknown and known addresses the same answer", async () => {
    const known = await (await call("forgot", { email }))!.json();
    const unknown = await (await call("forgot", { email: "nobody@example.invalid" }))!.json();
    assert.deepEqual(known, unknown);
  });
  it("revokes the link when the provider fails, without changing the answer", async () => {
    await ops.PasswordReset.deleteMany({});
    replies = [500, 500];
    const res = await call("forgot", { email });
    assert.equal(res!.status, 200);
    assert.equal(await ops.PasswordReset.countDocuments({}), 0, "no usable token is left behind for an email that never went out");
  });
  it("fails clearly in production when email is not configured, for every address", async () => {
    setEnv({ NODE_ENV: "production", EMAIL_WEBHOOK_URL: undefined });
    const known = await call("forgot", { email });
    const unknown = await call("forgot", { email: "nobody@example.invalid" });
    assert.equal(known!.status, 503);
    assert.deepEqual(await known!.json(), await unknown!.json());
    assert.equal(sent.length, 0);
  });
});
