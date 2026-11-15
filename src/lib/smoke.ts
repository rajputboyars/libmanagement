export type SmokeStatus = "pass" | "fail" | "warn" | "skip";
export type SmokeCheck = { name: string; status: SmokeStatus; detail: string };
export type SmokeOptions = { allowHttp?: boolean; fetch?: typeof fetch; smokeLogin?: { email: string; password: string }; expectLegalReviewed?: boolean };

/**
 * Post-deployment smoke test: read-only HTTP checks of a running deployment (liveness, readiness, HTTPS/HSTS, security headers and CSP,
 * public legal routes, unauthenticated API refusal, error hygiene, session cookie flags). It creates nothing and logs in only when an
 * operator supplies a dedicated smoke account (student/staff: owner accounts need a second factor). Anything it cannot check is reported as
 * "skip" (NOT VERIFIED), never as a pass.
 */
export async function runSmoke(baseUrl: string, opts: SmokeOptions = {}): Promise<{ ok: boolean; checks: SmokeCheck[] }> {
  const doFetch = opts.fetch ?? fetch;
  const base = baseUrl.replace(/\/+$/, "");
  const checks: SmokeCheck[] = [];
  const add = (name: string, status: SmokeStatus, detail: string) => checks.push({ name, status, detail });
  const get = async (path: string, init: RequestInit = {}) => { try { const r = await doFetch(base + path, { redirect: "manual", signal: AbortSignal.timeout(15000), ...init }); return { r, text: await r.text() }; } catch (e) { return { r: null as Response | null, text: "", error: e instanceof Error ? e.message : String(e) }; } };
  const isHttps = base.startsWith("https://");

  add("HTTPS", isHttps ? "pass" : opts.allowHttp ? "warn" : "fail", isHttps ? "served over https" : opts.allowHttp ? "plain http allowed for this run (local test only)" : "the deployment URL is not https");

  const live = await get("/api/health");
  add("liveness /api/health", live.r?.status === 200 && live.r.headers.get("cache-control") === "no-store" ? "pass" : "fail", live.r ? `HTTP ${live.r.status}` : `unreachable: ${live.error}`);
  if (!live.r) return { ok: false, checks };

  const ready = await get("/api/ready");
  let readyBody: { status?: string; checks?: { database?: { ok?: boolean }; config?: { ok?: boolean }; jobs?: { ok?: boolean } }; alerting?: string; degraded?: boolean } = {};
  try { readyBody = JSON.parse(ready.text); } catch { /* not json */ }
  add("readiness /api/ready", ready.r?.status === 200 ? "pass" : "fail", ready.r ? `HTTP ${ready.r.status}: database ${readyBody.checks?.database?.ok ? "ok" : "NOT ok"}, configuration ${readyBody.checks?.config?.ok ? "ok" : "NOT ok"}` : "unreachable");
  add("readiness body is coarse", /mongodb|@|replicaSet|SESSION_SECRET|stack|ECONNREFUSED/i.test(ready.text) ? "fail" : "pass", "no credentials, hosts or driver errors in the readiness body");
  add("job heartbeat", readyBody.degraded ? "warn" : readyBody.checks?.jobs ? "pass" : "skip", readyBody.degraded ? "background jobs look stale (worker not running?)" : readyBody.checks?.jobs ? "jobs recent or none expected yet" : "not reported");
  add("alert destination configured", readyBody.alerting === "configured" ? "pass" : "fail", readyBody.alerting === "configured" ? "ALERT_WEBHOOK_URL is set (delivery itself must be proven separately)" : "ALERT_WEBHOOK_URL is not set");

  const home = await get("/");
  const h = (n: string) => home.r?.headers.get(n) ?? "";
  const csp = h("content-security-policy");
  const scriptSrc = /script-src([^;]*)/.exec(csp)?.[1] ?? "";
  add("CSP: nonce-based scripts, no unsafe-inline/eval", /'nonce-[\w+/=-]{16,}'/.test(scriptSrc) && !/unsafe-inline|unsafe-eval|\*/.test(scriptSrc) ? "pass" : "fail", scriptSrc ? `script-src ${scriptSrc.replace(/'nonce-[^']+'/, "'nonce-…'").trim()}` : "no Content-Security-Policy on documents");
  add("security headers", h("x-frame-options") === "DENY" && h("x-content-type-options") === "nosniff" && !!h("referrer-policy") ? "pass" : "fail", `X-Frame-Options=${h("x-frame-options") || "missing"}, nosniff=${h("x-content-type-options") || "missing"}, Referrer-Policy=${h("referrer-policy") || "missing"}`);
  add("HSTS", isHttps ? (/max-age=\d{7,}/.test(h("strict-transport-security")) ? "pass" : "fail") : "skip", isHttps ? (h("strict-transport-security") || "missing") : "only checked on https");
  add("no X-Powered-By", h("x-powered-by") ? "fail" : "pass", h("x-powered-by") || "absent");
  const api = await get("/api/health");
  add("API responses allow nothing (CSP)", api.r?.headers.get("content-security-policy") === "default-src 'none'; frame-ancestors 'none'" ? "pass" : "fail", api.r?.headers.get("content-security-policy") ?? "missing");

  for (const path of ["/privacy", "/terms"]) {
    const page = await get(path);
    const draft = /Draft pending legal review/.test(page.text);
    const real = page.text.includes(path === "/privacy" ? "Privacy Notice" : "Terms of Service") && /data-legal-version=/.test(page.text);
    add(`legal page ${path} (signed out)`, page.r?.status === 200 && real ? (draft && opts.expectLegalReviewed ? "fail" : draft ? "warn" : "pass") : "fail", page.r?.status === 200 ? (!real ? "reachable but it is not the versioned legal document" : draft ? "reachable, still marked DRAFT pending legal review" : "reachable and no draft notice") : `HTTP ${page.r?.status ?? "unreachable"}`);
  }
  for (const path of ["/login", "/register"]) { const p = await get(path); add(`public page ${path}`, p.r?.status === 200 && p.text.includes('href="/terms"') && p.text.includes('href="/privacy"') ? "pass" : "fail", "reachable and links to the Terms and Privacy Notice"); }

  for (const [path, accepted] of [["/api/workspace", [401]], ["/api/billing", [401]], ["/api/consent", [401]], ["/api/saas-admin?view=orgs", [401, 403]], ["/api/export", [401, 403]]] as [string, number[]][]) {
    const r = await get(path);
    add(`signed-out API refused: ${path}`, r.r && accepted.includes(r.r.status) ? "pass" : "fail", `HTTP ${r.r?.status ?? "unreachable"}`);
  }
  const missing = await get("/api/definitely-not-a-route");
  add("error hygiene", /node_modules|\bat\s+\S+\s+\(|stack|ECONN|mongo/i.test(missing.text) ? "fail" : "pass", "an unknown API route reveals no stack trace or internals");
  const badLogin = await get("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ email: "smoke-nobody@example.invalid", password: "not-a-real-password-1" }) });
  add("failed sign-in sets no session", badLogin.r && !badLogin.r.headers.get("set-cookie") && badLogin.r.status >= 400 ? "pass" : "fail", `HTTP ${badLogin.r?.status ?? "unreachable"}`);
  const robots = await get("/robots.txt");
  add("robots.txt keeps private areas out of search", /Disallow:\s*\/owner/.test(robots.text) ? "pass" : "fail", robots.r ? `HTTP ${robots.r.status}` : "unreachable");

  if (opts.smokeLogin) {
    const login = await get("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify(opts.smokeLogin) });
    const cookie = login.r?.headers.get("set-cookie") ?? "";
    if (!cookie) add("session cookie flags", "skip", `no session issued (HTTP ${login.r?.status ?? "?"}); use a student/staff smoke account without two-step sign-in`);
    else {
      const ok = /sq-session=/.test(cookie) && /HttpOnly/i.test(cookie) && /SameSite=Lax/i.test(cookie) && /Path=\//.test(cookie) && (isHttps ? /Secure/i.test(cookie) : true) && /Max-Age=(\d+)/i.test(cookie) && Number(/Max-Age=(\d+)/i.exec(cookie)![1]) <= 604800;
      add("session cookie flags", ok ? "pass" : "fail", "HttpOnly, SameSite=Lax, Path=/, max 7 days" + (isHttps ? ", Secure" : ""));
    }
  } else add("session cookie flags", "skip", "NOT VERIFIED: no smoke account supplied (SMOKE_EMAIL / SMOKE_PASSWORD)");
  add("mandatory two-step sign-in for owners/admins", "skip", "NOT VERIFIED by this script: sign in as a brand-new owner and confirm the enrolment screen appears and no dashboard API answers before enrolment (docs/PILOT_RUNBOOK.md)");

  return { ok: !checks.some((c) => c.status === "fail"), checks };
}
