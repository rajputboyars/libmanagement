"use client";

import Link from "next/link";
import { motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  GraduationCap,
  Library,
  ListVideo,
  PlayCircle,
  Sparkles,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  guideCategories,
  guidePages,
  type GuidePage,
} from "@/lib/guide-content";
import {
  ownerGuide,
  studentGuide,
  type GuideRole,
  type GuideVideo,
} from "@/lib/guide-videos";

const videosBy: Record<GuideRole, GuideVideo[]> = {
  student: studentGuide,
  owner: ownerGuide,
};
const roleCopy: Record<
  GuideRole,
  {
    hindi: string;
    english: string;
    intro: string;
    points: string[];
    icon: typeof Library;
  }
> = {
  student: {
    hindi: "Student Portal Guide",
    english: "Student portal guide",
    intro:
      "Everything a student can do in StudyQuest: join a library, mark attendance, study with a focus timer, earn XP and badges, prepare for exams and stay safe in the community.",
    points: [
      "Seat, fees and receipts always in the app",
      "Server-verified study time and streaks",
      "Quests, badges and real rewards",
      "Mock tests, smart revision and a planner",
    ],
    icon: GraduationCap,
  },
  owner: {
    hindi: "Library Owner Guide",
    english: "Library owner guide",
    intro:
      "Everything a library owner can do: set up seats and shifts, admit students with a Library ID, collect fees with receipts, track attendance live, and understand profit with reports.",
    points: [
      "Setup in minutes, no double bookings",
      "Digital receipts and clear dues",
      "Live attendance with location or QR checks",
      "Reports, admissions CRM and staff control",
    ],
    icon: Library,
  },
};
const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
// The site's global link colour is unlayered, so button text colours need "!" to win over it.
const linkBtn = (variant: "default" | "outline" = "default") =>
  `${buttonVariants({ variant, size: "lg" })} h-11 px-5 text-[15px] no-underline ${variant === "default" ? "!text-primary-foreground" : "!text-[var(--text)]"}`;
const reveal = {
  initial: { opacity: 0, y: 18 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-40px" },
  transition: { duration: 0.45, ease: "easeOut" as const },
};
// Hinglish headings; kept as a class so the guide font can be tuned in one place.
const hi = "guide-hi";
const muted = "text-[var(--text-muted,var(--muted))]";
const card = "rounded-2xl border border-[var(--line)] bg-[var(--surface)]";

function videoFor(role: GuideRole, slug: string) {
  return videosBy[role].find((v) => v.slug === slug);
}

/** Two big entry cards at the top of /guide. */
export function GuideHubCards() {
  return (
    <div className="mx-auto mb-12 grid max-w-[1120px] gap-5 md:grid-cols-2">
      {(["student", "owner"] as GuideRole[]).map((role, i) => {
        const c = roleCopy[role];
        const Icon = c.icon;
        return (
          <motion.div
            key={role}
            {...reveal}
            transition={{ ...reveal.transition, delay: i * 0.08 }}
          >
            <Link
              href={`/guide/${role}`}
              className="group flex h-full flex-col gap-4 rounded-3xl border border-[var(--line)] bg-[var(--surface)] p-7 text-[var(--text)] no-underline shadow-[0_18px_50px_-30px_rgba(18,59,46,.45)] transition hover:-translate-y-1 hover:border-[var(--green)]"
            >
              <span className="grid size-12 place-items-center rounded-2xl bg-[var(--soft)] text-[var(--green)]">
                <Icon size={24} />
              </span>
              <div>
                <h2 className={`m-0 text-[28px] font-bold leading-tight ${hi}`}>
                  {c.hindi}
                </h2>
                <p
                  className={`mt-1 text-sm uppercase tracking-[0.12em] ${muted}`}
                >
                  {c.english} · {guidePages[role].length} pages
                </p>
              </div>
              <p className={`m-0 text-[15px] leading-relaxed ${muted}`}>
                {c.intro}
              </p>
              <span className="mt-auto inline-flex items-center gap-2 font-semibold text-[var(--green)]">
                Explore every page{" "}
                <ArrowRight
                  size={17}
                  className="transition group-hover:translate-x-1"
                />
              </span>
            </Link>
          </motion.div>
        );
      })}
    </div>
  );
}

function PageCard({
  role,
  page,
  index,
}: {
  role: GuideRole;
  page: GuidePage;
  index: number;
}) {
  const v = videoFor(role, page.slug);
  return (
    <motion.li
      {...reveal}
      transition={{ ...reveal.transition, delay: (index % 6) * 0.04 }}
      className="list-none"
    >
      <Link
        href={`/guide/${role}/${page.slug}`}
        className={`group flex h-full flex-col overflow-hidden ${card} text-[var(--text)] no-underline transition hover:-translate-y-1 hover:border-[var(--green)]`}
      >
        {v && (
          <span className="relative block">
            {/* Posters are tiny static JPGs; next/image adds nothing here. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={v.poster}
              alt=""
              loading="lazy"
              width={320}
              height={180}
              className="block aspect-video w-full object-cover"
            />
            <span className="absolute bottom-2 right-2 rounded-md bg-black/70 px-2 py-0.5 text-xs tabular-nums text-white">
              {clock(v.seconds)}
            </span>
            <span className="absolute bottom-2 left-2 grid size-8 place-items-center rounded-full bg-white/90 text-[var(--green)]">
              <PlayCircle size={18} />
            </span>
          </span>
        )}
        <span className="flex flex-1 flex-col gap-1.5 p-4">
          <small className={`text-xs ${muted}`}>{v?.page ?? page.slug}</small>
          <strong className={`text-[17px] ${hi}`}>
            {v?.title ?? page.slug}
          </strong>
          <span className={`text-[13.5px] leading-relaxed ${muted}`}>
            {page.summary}
          </span>
        </span>
      </Link>
    </motion.li>
  );
}

/** /guide/student and /guide/owner: intro, highlights and every page grouped by area. */
export function GuidePortal({ role }: { role: GuideRole }) {
  const c = roleCopy[role];
  const pages = guidePages[role];
  const first = videosBy[role][0];
  const minutes = Math.round(
    videosBy[role].reduce((n, v) => n + v.seconds, 0) / 60,
  );
  return (
    <section className="mx-auto max-w-[1180px] px-4 pb-20 pt-10 sm:px-6">
      <nav aria-label="Breadcrumb" className={`mb-6 text-sm ${muted}`}>
        <Link href="/guide" className="text-inherit">
          Guide
        </Link>{" "}
        <span aria-hidden="true">/</span> {c.english}
      </nav>
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_.9fr]">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--soft)] px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--green)]">
            <Sparkles size={14} /> {c.english}
          </span>
          <h1
            className={`mb-4 mt-4 text-[clamp(36px,6vw,64px)] font-bold leading-[1.05] tracking-tight ${hi}`}
          >
            {c.hindi}
          </h1>
          <p className={`max-w-[60ch] text-[17px] leading-relaxed ${muted}`}>
            {c.intro}
          </p>
          <ul className="my-6 grid gap-2.5 p-0 sm:grid-cols-2">
            {c.points.map((p) => (
              <li
                key={p}
                className="flex list-none items-start gap-2 text-[15px]"
              >
                <CheckCircle2
                  size={18}
                  className="mt-0.5 shrink-0 text-[var(--green)]"
                />
                {p}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Link href={`/guide?for=${role}`} className={linkBtn()}>
              <ListVideo size={18} /> Watch the full tour · {minutes} min
            </Link>
            <Link href="/register" className={linkBtn("outline")}>
              Get started free <ArrowRight size={17} />
            </Link>
          </div>
        </div>
        <video
          src={first.src}
          poster={first.poster}
          controls
          playsInline
          preload="none"
          className="aspect-video w-full rounded-3xl bg-[#123b2e] shadow-[0_30px_80px_-40px_rgba(18,59,46,.6)]"
        />
      </div>
      {guideCategories[role].map((cat) => {
        const inCat = pages.filter((p) => p.category === cat);
        if (!inCat.length) return null;
        return (
          <div key={cat} className="mt-16">
            <motion.h2
              {...reveal}
              className="mb-5 flex items-baseline gap-3 text-[26px] font-bold tracking-tight"
            >
              {cat}{" "}
              <span className={`text-sm font-medium ${muted}`}>
                {inCat.length} pages
              </span>
            </motion.h2>
            <ul className="m-0 grid gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
              {inCat.map((p, i) => (
                <PageCard key={p.slug} role={role} page={p} index={i} />
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}

/** /guide/<role>/<slug>: video, what it does, why it helps, Hindi step-by-step, prev/next. */
export function GuideDetail({ role, slug }: { role: GuideRole; slug: string }) {
  const pages = guidePages[role];
  const i = pages.findIndex((p) => p.slug === slug);
  if (i < 0) return null;
  const page = pages[i];
  const v = videoFor(role, slug);
  const prev = pages[i - 1];
  const next = pages[i + 1];
  const c = roleCopy[role];
  return (
    <article className="mx-auto max-w-[980px] px-4 pb-20 pt-10 sm:px-6">
      <nav
        aria-label="Breadcrumb"
        className={`mb-6 flex flex-wrap gap-1.5 text-sm ${muted}`}
      >
        <Link href="/guide" className="text-inherit">
          Guide
        </Link>
        <span aria-hidden="true">/</span>
        <Link href={`/guide/${role}`} className="text-inherit">
          {c.english}
        </Link>
        <span aria-hidden="true">/</span>
        <span>{v?.page ?? slug}</span>
      </nav>
      <header>
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--green)]">
          {page.category} · {i + 1} of {pages.length}
        </span>
        <h1
          className={`mb-2 mt-3 text-[clamp(32px,5vw,52px)] font-bold leading-tight tracking-tight ${hi}`}
        >
          {v?.title ?? slug}
        </h1>
        <p className={`m-0 text-lg ${muted}`}>
          <span className={hi}>{v?.subtitle}</span> · {v?.page}
        </p>
      </header>
      {v && (
        <div className="mt-7">
          <video
            key={v.src}
            src={v.src}
            poster={v.poster}
            controls
            playsInline
            preload="none"
            className="aspect-video w-full rounded-3xl bg-[#123b2e] shadow-[0_30px_80px_-40px_rgba(18,59,46,.6)]"
          />
          <p className={`mt-2 text-sm ${muted}`}>
            Hindi video · {clock(v.seconds)}
          </p>
        </div>
      )}
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <motion.section {...reveal} className={`${card} p-6`}>
          <h2 className="m-0 mb-2 text-lg font-bold">What this page does</h2>
          <p className={`m-0 leading-relaxed ${muted}`}>{page.summary}</p>
        </motion.section>
        <motion.section
          {...reveal}
          className="rounded-2xl border border-[var(--green)] bg-[var(--soft)] p-6"
        >
          <h2 className="m-0 mb-2 text-lg font-bold">
            {role === "owner"
              ? "How it helps your library"
              : "How it helps you"}
          </h2>
          <p className="m-0 leading-relaxed">{page.benefit}</p>
        </motion.section>
      </div>
      <motion.section {...reveal} className="mt-10">
        <h2 className={`mb-5 text-[26px] font-bold ${hi}`}>Step by step</h2>
        <ol className="m-0 grid gap-4 p-0">
          {page.steps.map((s, n) => (
            <li key={n} className={`flex list-none gap-4 ${card} p-5`}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[var(--green)] font-bold text-white">
                {n + 1}
              </span>
              <div className={hi}>
                <strong className="block text-[17px]">{s.caption}</strong>
                <p className={`mb-0 mt-1 leading-relaxed ${muted}`}>{s.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </motion.section>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={page.appPath} className={linkBtn()}>
          <ExternalLink size={17} /> Open this page in StudyQuest
        </Link>
        <Link href={`/guide/${role}`} className={linkBtn("outline")}>
          All {c.english.toLowerCase()} pages
        </Link>
      </div>
      <nav
        aria-label="More guide pages"
        className="mt-12 grid gap-4 sm:grid-cols-2"
      >
        {prev ? (
          <Link
            href={`/guide/${role}/${prev.slug}`}
            className={`flex flex-col gap-1 ${card} p-5 text-[var(--text)] no-underline hover:border-[var(--green)]`}
          >
            <small className={`inline-flex items-center gap-1 ${muted}`}>
              <ArrowLeft size={14} /> Previous
            </small>
            <strong className={hi}>
              {videoFor(role, prev.slug)?.title ?? prev.slug}
            </strong>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link
            href={`/guide/${role}/${next.slug}`}
            className={`flex flex-col items-end gap-1 ${card} p-5 text-right text-[var(--text)] no-underline hover:border-[var(--green)]`}
          >
            <small className={`inline-flex items-center gap-1 ${muted}`}>
              Next <ArrowRight size={14} />
            </small>
            <strong className={hi}>
              {videoFor(role, next.slug)?.title ?? next.slug}
            </strong>
          </Link>
        )}
      </nav>
    </article>
  );
}
