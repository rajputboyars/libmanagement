export type BillingConfigProblem = { level: "error" | "warn"; key: string; message: string };

/**
 * Pure validation of the payment-gateway settings. It never returns or logs a secret value: messages name variables only.
 * Goals: partial configuration never silently degrades to the sandbox, a TEST key can never be mistaken for a LIVE one (or the reverse),
 * and a LIVE key is refused anywhere except a production deployment on https.
 */
export function billingConfigProblems(env: Record<string, string | undefined>): BillingConfigProblem[] {
  const out: BillingConfigProblem[] = [];
  const id = env.RAZORPAY_KEY_ID, secret = env.RAZORPAY_KEY_SECRET, hook = env.RAZORPAY_WEBHOOK_SECRET;
  const set = [id, secret, hook].filter(Boolean).length;
  if (set === 0) return out; // not configured: reported separately as a warning
  const prod = env.NODE_ENV === "production";
  if (set < 3) out.push({ level: "error", key: "RAZORPAY_*", message: `Razorpay settings are incomplete (missing ${[!id && "RAZORPAY_KEY_ID", !secret && "RAZORPAY_KEY_SECRET", !hook && "RAZORPAY_WEBHOOK_SECRET"].filter(Boolean).join(", ")}); checkouts are disabled and the sandbox is NOT used as a fallback` });
  if (id && !/^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(id)) out.push({ level: "error", key: "RAZORPAY_KEY_ID", message: "Must look like rzp_test_… or rzp_live_… (the gateway key id)" });
  const live = !!id?.startsWith("rzp_live_");
  if (live && !prod) out.push({ level: "error", key: "RAZORPAY_KEY_ID", message: "A LIVE key is only allowed when NODE_ENV=production; use rzp_test_ keys everywhere else so real customers can never be charged from a non-production environment" });
  if (live && !env.APP_URL?.startsWith("https://")) out.push({ level: "error", key: "APP_URL", message: "Live billing requires the canonical https:// APP_URL" });
  const expect = env.BILLING_EXPECT_MODE;
  if (expect && !["live", "test"].includes(expect)) out.push({ level: "error", key: "BILLING_EXPECT_MODE", message: "Must be live or test" });
  else if (expect && id && /^rzp_(test|live)_/.test(id) && (expect === "live") !== live) out.push({ level: "error", key: "BILLING_EXPECT_MODE", message: `This deployment expects ${expect} billing but RAZORPAY_KEY_ID is a ${live ? "live" : "test"} key` });
  if (secret && hook && secret === hook) out.push({ level: "error", key: "RAZORPAY_WEBHOOK_SECRET", message: "Must differ from RAZORPAY_KEY_SECRET (they are different credentials)" });
  if (hook && hook.length < 12) out.push({ level: "error", key: "RAZORPAY_WEBHOOK_SECRET", message: "Too short: use a long random webhook secret (at least 16 characters)" });
  else if (hook && hook.length < 16) out.push({ level: "warn", key: "RAZORPAY_WEBHOOK_SECRET", message: "Use at least 16 random characters" });
  if (env.ALLOW_BILLING_SANDBOX === "1") out.push({ level: "error", key: "ALLOW_BILLING_SANDBOX", message: "Sandbox billing must not be enabled together with gateway credentials" });
  if (env.RAZORPAY_API_BASE) out.push({ level: live ? "error" : "warn", key: "RAZORPAY_API_BASE", message: live ? "The gateway base URL cannot be overridden with a live key" : "Gateway base URL override is active (test keys only: for a local simulator)" });
  return out;
}
