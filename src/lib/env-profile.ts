import { billingConfigProblems } from "./billing-config";

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
    if (!env.EMAIL_WEBHOOK_URL) err("EMAIL_WEBHOOK_URL", "Required: password reset, invitations and verification cannot work without it");
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
    if (!env.ALERT_WEBHOOK_URL) err("ALERT_WEBHOOK_URL", "Required: nobody would be told about outages, crashes or failed payments");
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

/** True when the process must refuse to start: an explicit APP_ENV profile is set and it has errors. */
export function mustRefuseToStart(env: Env, role: Role = "web") {
  const profile = env.APP_ENV;
  if (profile !== "staging" && profile !== "production") return { refuse: false as const, problems: [] as ProfileProblem[] };
  const problems = profileProblems(env, profile, role);
  return { refuse: problems.some((p) => p.level === "error"), problems };
}
