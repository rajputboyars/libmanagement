import { billingConfigProblems } from "./billing-config";
import { parsePoolSize } from "./db-config";

export type Profile = "staging" | "production";
export type Role = "web" | "worker" | "backup";
export type ProfileProblem = { level: "error" | "warn"; key: string; message: string };
type Env = Record<string, string | undefined>;

const LOCAL = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i;
const PLACEHOLDER = /replace-with|changeme|change-me|example|secret|password|xxx/i;
const hostOf = (url: string) => { try { return new URL(url).hostname; } catch { return ""; } };

/**
 * Deployment-profile validation, run per process role (web, worker, backup job) before and during start-up.
 * It never returns a secret value: messages name variables only. "staging" and "production" have different, stricter rules than the
 * generic `checkEnv` health check; the point is that a misconfigured or mixed-up environment is refused instead of running.
 * Staging may only use TEST payment keys; production must state explicitly whether it expects live or test keys.
 */
export function profileProblems(env: Env, profile: Profile, role: Role = "web"): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const err = (key: string, message: string) => out.push({ level: "error", key, message });
  const warn = (key: string, message: string) => out.push({ level: "warn", key, message });

  if (env.APP_ENV !== profile) err("APP_ENV", `Must be set to "${profile}" for this environment (it labels the deployment and stops staging and production settings being mixed up)`);
  if (env.NODE_ENV !== "production") err("NODE_ENV", "Must be production for a staging or production deployment (a development build has weaker security)");

  if (role !== "backup") {
    const uri = env.MONGODB_URI ?? "";
    if (!uri) err("MONGODB_URI", "Required");
    else if (!/^mongodb(\+srv)?:\/\//.test(uri)) err("MONGODB_URI", "Must be a mongodb:// or mongodb+srv:// connection string");
    else if (LOCAL.test(uri.replace(/^mongodb(\+srv)?:\/\/(?:[^@/]*@)?/, ""))) err("MONGODB_URI", "Points at a local or private address: use the managed replica-set cluster for this environment");
    const secret = env.SESSION_SECRET ?? "";
    if (secret.length < 32) err("SESSION_SECRET", "Must be at least 32 random characters, different in every environment");
    else if (PLACEHOLDER.test(secret)) err("SESSION_SECRET", "Looks like a placeholder value");
    const tf = env.TWO_FACTOR_KEY ?? "";
    if (role === "web") {
      if (tf.length < 32) err("TWO_FACTOR_KEY", "A dedicated 32+ character key is required: it encrypts authenticator secrets, and mandatory two-step sign-in for owners and admins depends on it (rotating it invalidates enrolled authenticators)");
      else if (tf === secret) err("TWO_FACTOR_KEY", "Must differ from SESSION_SECRET");
    }
    // Backup credentials never belong in the processes that serve users.
    for (const k of ["BACKUP_ENCRYPTION_KEYS", "BACKUP_S3_SECRET_ACCESS_KEY", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_SOURCE_URI", "RESTORE_TARGET_URI"]) if (env[k]) err(k, "Backup and restore credentials must be set only on the backup host, never on the web or worker process");
  }

  if (role === "web") {
    const url = env.APP_URL ?? "";
    if (!url.startsWith("https://")) err("APP_URL", "Must be the canonical https:// origin");
    else if (LOCAL.test(hostOf(url))) err("APP_URL", "Must be the public domain, not a local address");
    else if (profile === "staging" && !/staging|stg|test|qa|preview/i.test(hostOf(url))) warn("APP_URL", "A staging URL should be clearly distinguishable from production (for example staging.<domain>)");
    if (env.TRUST_PROXY !== "1" && env.VERCEL !== "1") err("TRUST_PROXY", "Set TRUST_PROXY=1 when behind the TLS proxy/load balancer that overwrites X-Forwarded-For; without it every visitor shares one rate-limit bucket");
    if (!env.EMAIL_WEBHOOK_URL) { if (env.EMAIL_DELIVERY_OPTIONAL === "1") warn("EMAIL_WEBHOOK_URL", "Not configured (acknowledged with EMAIL_DELIVERY_OPTIONAL=1): password reset, invitations and verification emails are NOT delivered. Remove the flag once an email relay is set up"); else err("EMAIL_WEBHOOK_URL", "Required: password reset, invitations and verification cannot work without it (set EMAIL_DELIVERY_OPTIONAL=1 only to knowingly run without email)"); }
    else if (!env.EMAIL_WEBHOOK_URL.startsWith("https://")) err("EMAIL_WEBHOOK_URL", "Must be https://");
    if (env.ALLOW_BILLING_SANDBOX === "1") err("ALLOW_BILLING_SANDBOX", "Must be unset: the local sandbox moves no money and must not exist in a deployed environment");
    if (!env.CRON_SECRET && env.VERCEL === "1") warn("CRON_SECRET", "Needed for the HTTP job trigger on serverless hosting");

    // Payments: separate test and live worlds, never mixed up.
    const id = env.RAZORPAY_KEY_ID ?? "";
    for (const p of billingConfigProblems(env)) out.push(p);
    if (!id) warn("RAZORPAY_KEY_ID", "Not configured: paid subscriptions are off (acceptable only if the pilot runs on the free plan)");
    else if (profile === "staging" && id.startsWith("rzp_live_")) err("RAZORPAY_KEY_ID", "A LIVE key is forbidden in staging: staging must only ever use rzp_test_ keys");
    else if (profile === "production") {
      if (!env.BILLING_EXPECT_MODE) err("BILLING_EXPECT_MODE", 'Required in production: set "live" to take real payments, or "test" to run a pilot with Razorpay test keys only (no real charges)');
      else if (id.startsWith("rzp_test_") && env.BILLING_EXPECT_MODE === "test") warn("RAZORPAY_KEY_ID", "Production is running on Razorpay TEST keys: payments are simulated and no real money is collected");
    } else if (profile === "staging" && env.BILLING_EXPECT_MODE && env.BILLING_EXPECT_MODE !== "test") err("BILLING_EXPECT_MODE", 'Must be "test" in staging');
    if (env.RAZORPAY_API_BASE && profile === "production") err("RAZORPAY_API_BASE", "The gateway base URL must not be overridden in production");
  }

  if (role !== "backup") {
    if (!env.ALERT_WEBHOOK_URL) { if (env.ALERTS_OPTIONAL === "1") warn("ALERT_WEBHOOK_URL", "Not configured (acknowledged with ALERTS_OPTIONAL=1): alerts are only written to the logs and nobody is notified of outages or failed payments. Remove the flag once an alert destination is set up"); else err("ALERT_WEBHOOK_URL", "Required: nobody would be told about outages, crashes or failed payments (set ALERTS_OPTIONAL=1 only to knowingly run without notifications)"); }
    else if (!env.ALERT_WEBHOOK_URL.startsWith("https://")) err("ALERT_WEBHOOK_URL", "Must be https://");
    if (role === "worker" && !env.WORKER_HEARTBEAT_URL) warn("WORKER_HEARTBEAT_URL", "Recommended: a dead-man's-switch that notices a worker that silently stopped");
  }
  if (role === "backup") {
    if (!env.BACKUP_SOURCE_URI) err("BACKUP_SOURCE_URI", "Required: a dedicated READ-ONLY database user");
    if (!env.BACKUP_ENCRYPTION_KEYS) err("BACKUP_ENCRYPTION_KEYS", "Required");
    if (!env.BACKUP_S3_BUCKET && !env.BACKUP_DIR) err("BACKUP_S3_BUCKET", "No backup destination configured (bucket in a separate failure domain, or a mounted off-site volume)");
    if (env.BACKUP_S3_BUCKET) for (const k of ["BACKUP_S3_REGION", "BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"]) if (!env[k]) err(k, "Required with BACKUP_S3_BUCKET");
    if (!env.BACKUP_HEARTBEAT_URL) warn("BACKUP_HEARTBEAT_URL", "Recommended: without it a backup job that silently stops is not noticed");
    if (!env.ALERT_WEBHOOK_URL) err("ALERT_WEBHOOK_URL", "Required: failed or stale backups must alert someone");
    if (env.BACKUP_SOURCE_URI && env.MONGODB_URI && env.BACKUP_SOURCE_URI === env.MONGODB_URI) warn("BACKUP_SOURCE_URI", "Equals the application's read/write URI: use a read-only user");
  }

  for (const k of ["TEST_STUDENT_PASSWORD", "TEST_STUDENT_EMAIL", "SEED_PASSWORD", "SEED_EMAIL"]) if (env[k]) warn(k, "Development/test credential variable is present in a deployed environment: remove it");
  if (env.ADMIN_PASSWORD) warn("ADMIN_PASSWORD", "Bootstrap-only variable: remove it after the first platform admin has been created and enrolled");
  if (env.LOG_LEVEL === "debug") warn("LOG_LEVEL", "debug logging in a deployed environment is noisy; use info");
  if (env.MONITOR_PROCESS_HANDLERS) warn("MONITOR_PROCESS_HANDLERS", "Development-only switch");
  return out;
}

/** True when the process must refuse to start: an explicit APP_ENV profile with errors, or a Vercel environment guard violation (checked even without APP_ENV). */
export function mustRefuseToStart(env: Env, role: Role = "web") {
  const profile = env.APP_ENV;
  const problems = [...vercelProblems(env), ...(profile === "staging" || profile === "production" ? profileProblems(env, profile, role) : [])];
  const seen = new Set<string>();
  const unique = problems.filter((p) => { const k = `${p.key}|${p.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { refuse: unique.some((p) => p.level === "error"), problems: unique };
}

/**
 * Vercel environment separation (VERCEL_ENV is set by the platform: production | preview | development). These guards run even when APP_ENV is unset,
 * because Preview deployments are created for every pushed branch and must never be able to touch production data:
 *  - a Production deployment must be labelled APP_ENV=production, a Preview deployment must never be;
 *  - a Preview deployment's MONGODB_URI must not point at a protected (production) database listed in PROTECTED_DB_TARGETS
 *    (non-secret "host1,host2/dbname" or full URIs, separated by ";"; set it in the Preview scope);
 *  - a Preview deployment can never run on a live payment key or with the demo/sandbox switches of production.
 * Scoping the variables in Vercel is still the primary control; this is the safety net that refuses to start when the scoping is wrong.
 */
export function vercelProblems(env: Env): ProfileProblem[] {
  const out: ProfileProblem[] = [];
  const err = (key: string, message: string) => out.push({ level: "error", key, message });
  const where = env.VERCEL_ENV;
  if (where === "production") {
    if (env.APP_ENV !== "production") err("APP_ENV", "A Vercel Production deployment must set APP_ENV=production (scope the variable to Production)");
  } else if (where === "preview") {
    if (env.APP_ENV === "production") err("APP_ENV", "A Vercel Preview deployment must never be labelled production: scope APP_ENV=production to the Production environment only");
    if (env.RAZORPAY_KEY_ID?.startsWith("rzp_live_")) err("RAZORPAY_KEY_ID", "A LIVE payment key is present in a Preview deployment: scope live keys to Production only");
    if (env.PROTECTED_DB_TARGETS && env.MONGODB_URI) {
      let mine = "";
      try { mine = fingerprintOf(env.MONGODB_URI); } catch { /* not a mongodb uri: reported elsewhere */ }
      for (const part of env.PROTECTED_DB_TARGETS.split(/;|\n+/).map((x) => x.trim()).filter(Boolean)) {
        const p = /^mongodb/.test(part) ? safeFingerprint(part) : normalizeTarget(part);
        if (mine && p && (p.hosts === mine.split("/")[0] && (!p.db || p.db === mine.split("/")[1]))) { err("MONGODB_URI", "A Preview deployment points at a protected (production) database: give Preview its own database credentials (Vercel Preview scope)"); break; }
      }
    }
    if (!env.APP_ENV) out.push({ level: "warn", key: "APP_ENV", message: "Set APP_ENV=staging for Preview deployments so the staging profile checks apply" });
    if (!env.PROTECTED_DB_TARGETS) out.push({ level: "warn", key: "PROTECTED_DB_TARGETS", message: "Set PROTECTED_DB_TARGETS (production database host/name, no credentials) in the Preview scope so a mis-scoped production URI is refused" });
  }
  const pool = parsePoolSize(env);
  if (pool.invalid) out.push({ level: "warn", key: "MONGODB_POOL_SIZE", message: `${pool.invalid}; the default (${pool.size}) is used` });
  return out;
}
const normalizeTarget = (t: string) => { const [h, d] = t.toLowerCase().split("/"); return { hosts: h.split(",").map((x) => x.trim().replace(/:27017$/, "")).sort().join(","), db: d ?? "" }; };
function fingerprintOf(uri: string) {
  const m = /^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/.exec(uri.trim());
  if (!m) throw new Error("not a mongodb uri");
  return `${m[1].toLowerCase().split(",").map((h) => h.replace(/:27017$/, "")).sort().join(",")}/${m[2] ?? ""}`;
}
function safeFingerprint(uri: string) { try { const f = fingerprintOf(uri); const [hosts, db] = f.split("/"); return { hosts, db }; } catch { return null; } }
