/**
 * Next.js compiles this file for both the Node.js and the Edge runtime. It therefore contains no Node-only code: everything that uses Node APIs
 * (process handlers, start-up refusal via process.exit, alert delivery) is in ./instrumentation-node and only imported when running on Node.js.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerNode } = await import("./instrumentation-node");
  await registerNode();
}

/** Called by Next for every uncaught server error in routes, actions and rendering. Never throws, never delays the response. */
export async function onRequestError(error: unknown, request: { path: string; method: string; headers: Record<string, string | string[] | undefined> }, context: { routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { reportRequestError } = await import("./instrumentation-node");
    await reportRequestError(error, request, context);
  } catch {
    // monitoring must never break request handling
  }
}
