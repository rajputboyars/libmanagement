const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy for documents is built per request in src/proxy.ts (nonce-based, see src/lib/csp.ts).
// API responses get a policy that allows nothing.
const apiCsp = "default-src 'none'; frame-ancestors 'none'";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

// Private and operational routes must never be indexed.
const noindex = { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" };

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  compress: true,
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      ...["/app/:path*", "/owner/:path*", "/super-admin/:path*", "/api/:path*", "/billing/:path*", "/login", "/register", "/reset-password", "/forgot-password", "/onboarding", "/r/:path*"].map((source) => ({ source, headers: [noindex] })),
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }] },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }, { key: "Content-Security-Policy", value: apiCsp }] },
    ];
  },
};
export default nextConfig;
