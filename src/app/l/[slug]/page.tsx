import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Library, MembershipPlan, Seat, SeatAssignment, Shift } from "@/lib/models";
import { EnquiryForm } from "@/components/public-enquiry";

export const revalidate = 300;
const base = () => (process.env.APP_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const money = (paise: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
const clock = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function load(slug: string) {
  await db();
  const library = await Library.findOne({ publicSlug: slug.toLowerCase(), listingVisible: true }).select("name branchName city address publicDescription facilities").lean<{ _id: unknown; name: string; branchName?: string; city?: string; address?: string; publicDescription?: string; facilities?: string[] }>();
  if (!library) return null;
  const now = new Date();
  const [plans, shifts, seats, inUse] = await Promise.all([
    MembershipPlan.find({ libraryId: library._id }).sort({ amount: 1 }).select("name amount days").lean<{ name: string; amount: number; days: number }[]>(),
    Shift.find({ libraryId: library._id }).sort({ start: 1 }).select("name start end").lean<{ name: string; start: number; end: number }[]>(),
    Seat.countDocuments({ libraryId: library._id, operationalStatus: { $ne: "maintenance" } }),
    SeatAssignment.distinct("seatId", { libraryId: library._id, start: { $lte: now }, end: { $gt: now } }),
  ]);
  return { library, plans, shifts, seats, available: Math.max(0, seats - inUse.length) };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const data = await load(slug).catch(() => null);
  if (!data) notFound(); // resolved before streaming so crawlers receive a real 404 status
  const title = `${data.library.name}${data.library.city ? ` · ${data.library.city}` : ""} — study library`;
  const description = data.library.publicDescription || `Study seats, shifts and fees at ${data.library.name}${data.library.city ? ` in ${data.library.city}` : ""}.`;
  return { title, description, alternates: { canonical: `${base()}/l/${slug}` }, openGraph: { title, description, url: `${base()}/l/${slug}`, type: "website", siteName: "StudyQuest" }, twitter: { card: "summary", title, description } };
}

export default async function LibraryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug).catch(() => null);
  if (!data) notFound();
  const { library, plans, shifts, seats, available } = data;
  // Structured data contains only facts the owner published or the system computed; no ratings or reviews are invented.
  const jsonLd = { "@context": "https://schema.org", "@type": "LocalBusiness", name: library.name, url: `${base()}/l/${slug}`, description: library.publicDescription || undefined, address: library.city || library.address ? { "@type": "PostalAddress", addressLocality: library.city, streetAddress: library.address } : undefined, amenityFeature: (library.facilities ?? []).map((f) => ({ "@type": "LocationFeatureSpecification", name: f.replaceAll("-", " "), value: true })) };
  return (
    <div className="discovery-public">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <header><Link className="brand" href="/"><span className="brand-mark">✳</span>StudyQuest<span className="brand-dot">.</span></Link><nav><Link href="/discover">All libraries</Link><Link href="/login">Sign in</Link></nav></header>
      <main>
        <article>
          <p className="eyebrow">{library.city || "Study library"}</p>
          <h1>{library.name}</h1>
          {library.publicDescription && <p>{library.publicDescription}</p>}
          <div className="mt-stats"><div><small>Seats available now</small><strong>{available} / {seats}</strong></div><div><small>Shifts</small><strong>{shifts.length}</strong></div><div><small>Plans from</small><strong>{plans[0] ? money(plans[0].amount) : "—"}</strong></div></div>
          {!!library.facilities?.length && <ul className="facility-chips">{library.facilities.map((f) => <li key={f} style={{ listStyle: "none" }}><span>{f.replaceAll("-", " ")}</span></li>)}</ul>}
          {shifts.length > 0 && <><h2>Shifts</h2><ul>{shifts.map((s) => <li key={s.name}>{s.name}: {clock(s.start)}–{clock(s.end)}</li>)}</ul></>}
          {plans.length > 0 && <><h2>Membership plans</h2><ul>{plans.map((p) => <li key={p.name}>{p.name}: {money(p.amount)} for {p.days} days</li>)}</ul></>}
          <h2>Ask about admission</h2>
          <EnquiryForm slug={slug} />
          <p className="pr-hint">Seat counts are calculated from live assignments. Availability can change; the library confirms every admission.</p>
        </article>
      </main>
    </div>
  );
}
