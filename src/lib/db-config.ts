/**
 * MongoDB client settings. Serverless hosts (Vercel) start many short-lived instances, each with its own pool, so the pool must be small:
 * connections used = instances x pool size, and Atlas limits total connections (the limit depends on the cluster tier: check it in Atlas).
 *   MONGODB_POOL_SIZE  integer 1..100. Default 5 on Vercel (VERCEL=1), 20 elsewhere (containers, local). An invalid value is ignored (default used)
 *                      and reported, never thrown: a typo must not take the site down.
 */
export const POOL_MIN = 1, POOL_MAX = 100;
export const defaultPoolSize = (env: Record<string, string | undefined>) => (env.VERCEL === "1" ? 5 : 20);

export function parsePoolSize(env: Record<string, string | undefined>): { size: number; source: "env" | "default"; invalid?: string } {
  const fallback = defaultPoolSize(env);
  const raw = env.MONGODB_POOL_SIZE;
  if (raw === undefined || raw.trim() === "") return { size: fallback, source: "default" };
  const value = raw.trim();
  if (!/^\d+$/.test(value)) return { size: fallback, source: "default", invalid: "MONGODB_POOL_SIZE must be a whole number" };
  const n = Number(value);
  if (n < POOL_MIN || n > POOL_MAX) return { size: fallback, source: "default", invalid: `MONGODB_POOL_SIZE must be between ${POOL_MIN} and ${POOL_MAX}` };
  return { size: n, source: "env" };
}

export function mongoOptions(env: Record<string, string | undefined>) {
  const serverless = env.VERCEL === "1";
  return {
    maxPoolSize: parsePoolSize(env).size,
    minPoolSize: 0,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45000,
    // Serverless instances are frozen between requests: close idle sockets instead of keeping them open on the cluster.
    ...(serverless ? { maxIdleTimeMS: 30000 } : {}),
  };
}
