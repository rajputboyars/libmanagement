export type EnvIssue = { level: "error" | "warn"; key: string; message: string };

/** Validates production configuration. Errors block readiness; warnings describe optional features that are not configured. */
export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvIssue[] {
  const issues: EnvIssue[] = [];
  const prod = env.NODE_ENV === "production";
  const need = (key: string, message: string, level: "error" | "warn" = "error") => { if (!env[key]) issues.push({ level, key, message }); };
  need("MONGODB_URI", "Database connection string is required");
  const secret = env.SESSION_SECRET ?? "";
  if (secret.length < 32) issues.push({ level: "error", key: "SESSION_SECRET", message: "Must be at least 32 random characters" });
  else if (/replace-with|changeme|secret/i.test(secret)) issues.push({ level: "error", key: "SESSION_SECRET", message: "Looks like a placeholder value" });
  if (prod) {
    if (!env.APP_URL?.startsWith("https://")) issues.push({ level: "error", key: "APP_URL", message: "Must be the canonical https:// origin in production" });
    if (env.TRUST_PROXY !== "1") issues.push({ level: "warn", key: "TRUST_PROXY", message: "Set TRUST_PROXY=1 only when behind a proxy that overwrites X-Forwarded-For; otherwise per-IP limits share one bucket" });
    if (env.ALLOW_BILLING_SANDBOX === "1") issues.push({ level: "error", key: "ALLOW_BILLING_SANDBOX", message: "Sandbox billing must not be enabled in production" });
    if (env.RAZORPAY_KEY_ID?.startsWith("rzp_test_")) issues.push({ level: "warn", key: "RAZORPAY_KEY_ID", message: "Gateway is in test mode: payments are sandbox data, not revenue" });
  }
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET) issues.push({ level: "warn", key: "RAZORPAY_*", message: "Billing gateway not configured: paid subscriptions cannot be taken" });
  need("CRON_SECRET", "Scheduled jobs cannot be triggered over HTTP without it (the worker process does not need it)", "warn");
  need("EMAIL_WEBHOOK_URL", "Password-reset, verification and billing emails will not be delivered", "warn");
  need("ALERT_WEBHOOK_URL", "No alert destination: failures are logged but nobody is notified", "warn");
  return issues;
}
