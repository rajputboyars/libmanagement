import type { MetadataRoute } from "next";

const base = () => (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: ["/", "/l/", "/pricing", "/features", "/discover", "/demo"], disallow: ["/app", "/owner", "/super-admin", "/api", "/billing", "/login", "/register", "/forgot-password", "/reset-password", "/onboarding"] }],
    sitemap: `${base()}/sitemap.xml`,
    host: base(),
  };
}
