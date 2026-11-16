import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "./lib/csp";

/** Attaches a correlation id to every request and response so logs, errors and support tickets can be tied together. */
export function proxy(request: NextRequest) {
  const incoming = request.headers.get("x-request-id");
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  const headers = new Headers(request.headers);
  headers.set("x-request-id", requestId);
  // Documents get a per-request nonce. Next.js finds it in the request's CSP header and applies it to its own scripts.
  const isApi = request.nextUrl.pathname.startsWith("/api/");
  let csp: string | undefined;
  if (!isApi) {
    csp = buildCsp(newNonce(), process.env.NODE_ENV === "production");
    headers.set("content-security-policy", csp);
  }
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("x-request-id", requestId);
  if (csp) response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = { matcher: ["/api/:path*", "/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest.webmanifest).*)"] };
