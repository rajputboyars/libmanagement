/**
 * Content-Security-Policy for HTML documents. Scripts run only when they carry this request's nonce (Next.js reads the
 * nonce from the request's CSP header and stamps it on every framework script it renders), and 'strict-dynamic' lets
 * those trusted scripts load the chunks they need. There is no 'unsafe-inline' for scripts and no host allow-list.
 *
 * Documented exception: style-src keeps 'unsafe-inline'. React `style={{}}` attributes, Next's inlined CSS and the chart
 * library emit inline styles that cannot carry a nonce. Inline styles cannot execute script; every other directive stays locked.
 */
export function buildCsp(nonce: string, production: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}
/** API and other non-document responses get a policy that allows nothing. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
export const newNonce = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
