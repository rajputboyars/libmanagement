import { test } from "node:test";
import assert from "node:assert/strict";
import { cronAuthorized } from "../src/lib/cron-auth";

const h = (init: Record<string, string>) => new Headers(init);
const secret = "a".repeat(64);

test("accepts Vercel Cron bearer token and the x-cron-secret header", () => {
  assert.equal(cronAuthorized(h({ authorization: `Bearer ${secret}` }), secret), true);
  assert.equal(cronAuthorized(h({ "x-cron-secret": secret }), secret), true);
});

test("rejects missing, wrong or unconfigured secrets", () => {
  assert.equal(cronAuthorized(h({}), secret), false);
  assert.equal(cronAuthorized(h({ authorization: "Bearer wrong" }), secret), false);
  assert.equal(cronAuthorized(h({ authorization: secret }), secret), false);
  assert.equal(cronAuthorized(h({ authorization: "Bearer " }), ""), false);
  assert.equal(cronAuthorized(h({ "x-cron-secret": "" }), undefined), false);
});
