import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { Library } from "@/lib/models";
import { guidePaths } from "@/lib/guide-route";

const base = () => (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
export const dynamic = "force-dynamic";

/** Public pages only. Library pages are listed only when the owner has made the listing visible. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = ["", "/features", "/guide", "/pricing", "/discover", "/demo", "/privacy", "/terms", ...guidePaths()].map((p) => ({ url: `${base()}${p}`, lastModified: now, changeFrequency: p === "" ? "weekly" : "monthly", priority: p === "" ? 1 : 0.7 }));
  try {
    await db();
    const libs = await Library.find({ listingVisible: true, publicSlug: { $exists: true, $ne: "" } }).select("publicSlug updatedAt").limit(5000).lean<{ publicSlug: string; updatedAt: Date }[]>();
    return [...pages, ...libs.map((l) => ({ url: `${base()}/l/${l.publicSlug}`, lastModified: l.updatedAt, changeFrequency: "weekly" as const, priority: 0.6 }))];
  } catch {
    return pages; // database unavailable: still serve the static pages
  }
}
