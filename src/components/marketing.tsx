"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Check, PlayCircle } from "lucide-react";
import { ownerGuide, studentGuide, type GuideVideo } from "@/lib/guide-videos";
import { buttonVariants } from "@/components/ui/button";
import { useUI } from "@/lib/ui-store";
import {
  comingSoon,
  copy,
  dayFlow,
  ownerFeatures,
  say,
  studentFeatures,
  type FeatureGroup,
} from "@/lib/site-copy";

// The site's global link colour is unlayered, so link-buttons need "!" text colours to win over it.
const btn = (variant: "default" | "outline" = "default") =>
  `${buttonVariants({ variant, size: "lg" })} h-12 px-5 text-[15px] no-underline rounded-xl ${
    variant === "default"
      ? "!text-white"
      : "!text-[var(--text)] bg-[var(--surface)]"
  }`;
const muted = "text-[var(--text-muted,var(--muted))]";
const wrap = "mx-auto w-full max-w-[1160px] px-4 sm:px-6";
const eyebrow =
  "text-xs font-semibold uppercase tracking-[0.14em] text-[var(--green)]";
// "!" because the site's unlayered h1/h2 rules (weight 650, line-height 1.3) would otherwise win.
const serif =
  "!font-[family-name:var(--serif)] !font-normal tracking-[-0.01em] text-balance";

function useLang() {
  return useUI((s) => s.lang);
}

/* ───────────── Home ───────────── */

const broken = new Set([13, 38]);
const booked = {
  morning: new Set([
    0, 1, 2, 4, 5, 7, 8, 9, 10, 11, 14, 16, 17, 18, 20, 21, 22, 24, 25, 27, 28,
    30, 31, 33, 34, 36, 40, 41, 43, 44, 46,
  ]),
  evening: new Set([
    1, 2, 3, 5, 6, 9, 10, 12, 15, 17, 19, 22, 23, 26, 29, 32, 35, 39, 42, 45,
  ]),
};
const hatch =
  "repeating-linear-gradient(45deg, #cfc6b4 0 4px, transparent 4px 8px)";

/** Sample seat map: the same 48 seats booked differently per shift, two under repair. */
function SeatMap() {
  const lang = useLang();
  const [shift, setShift] = useState<"morning" | "evening">("morning");
  const busy = Array.from(
    { length: 48 },
    (_, i) => !broken.has(i) && booked[shift].has(i),
  );
  const filled = busy.filter(Boolean).length;
  const open = 48 - broken.size;
  const c = copy.seat;
  return (
    <div className="min-w-0 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-5 shadow-[0_28px_60px_-42px_rgba(32,116,91,.55)] sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={`${serif} m-0 text-[22px]`}>{say(lang, c.title)}</h2>
          <small className={`block text-[13px] ${muted}`}>
            {say(lang, c.sub)}
          </small>
        </div>
        <div
          className="inline-flex gap-1 rounded-[10px] border border-[var(--line)] p-[3px]"
          role="group"
          aria-label="Shift"
        >
          {(["morning", "evening"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={shift === s}
              onClick={() => setShift(s)}
              className={`rounded-[7px] px-3 py-2 text-[13px] font-semibold ${
                shift === s ? "bg-[var(--green)] !text-white" : muted
              }`}
            >
              {say(lang, c[s])}
            </button>
          ))}
        </div>
      </div>
      <div
        className="mt-4 grid grid-cols-8 gap-[5px] sm:gap-[7px]"
        aria-label="Seats in this shift"
      >
        {busy.map((isBusy, i) => {
          const isBroken = broken.has(i);
          return (
            <span
              key={i}
              title={`A${String(i + 1).padStart(2, "0")}`}
              style={
                isBroken
                  ? { background: hatch, borderColor: "#cfc6b4" }
                  : undefined
              }
              className={`grid aspect-square place-items-center rounded-lg border-[1.5px] font-mono text-[8px] font-semibold transition-colors duration-300 sm:text-[10px] ${
                isBusy
                  ? "border-[var(--green)] bg-[var(--green)] text-white"
                  : `border-[var(--line)] ${muted}`
              }`}
            >
              A{String(i + 1).padStart(2, "0")}
            </span>
          );
        })}
      </div>
      <div
        className={`mt-3.5 flex flex-wrap gap-x-[18px] gap-y-2 text-[13px] ${muted}`}
      >
        <span className="inline-flex items-center gap-1.5">
          <i className="size-3 rounded border-[1.5px] border-[var(--line)]" />
          {say(lang, c.free)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-3 rounded bg-[var(--green)]" />
          {say(lang, c.booked)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="size-3 rounded" style={{ background: hatch }} />
          {say(lang, c.repair)}
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2.5 border-t border-dashed border-[var(--line)] pt-3.5">
        {[
          [say(lang, c.filled), `${filled} / ${open}`],
          [say(lang, c.freeCount), String(open - filled)],
          [say(lang, c.dues), "₹4,800"],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0">
            <small className={`block text-xs ${muted}`}>{label}</small>
            <strong className="font-mono text-[19px] font-semibold tabular-nums">
              {value}
            </strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function Wins({ list }: { list: typeof copy.ownerWins }) {
  const lang = useLang();
  return (
    <ul className="m-0 grid list-none gap-2 p-0">
      {list.map((w) => (
        <li key={w.en} className="flex gap-2.5 text-[15px]">
          <span className="mt-0.5 grid size-[21px] flex-none place-items-center rounded-full bg-[var(--soft)] text-[var(--green)]">
            <Check size={12} strokeWidth={3} />
          </span>
          {say(lang, w)}
        </li>
      ))}
    </ul>
  );
}

/** The two Overview videos (student and owner) with links into the full guide. */
function HomeVideos() {
  const lang = useLang();
  const v = copy.videos;
  const items = [
    {
      role: "student",
      label: v.student,
      text: v.studentText,
      video: studentGuide[0],
      count: studentGuide.length,
    },
    {
      role: "owner",
      label: v.owner,
      text: v.ownerText,
      video: ownerGuide[0],
      count: ownerGuide.length,
    },
  ];
  return (
    <div className="mt-14">
      <div className="mb-7 grid max-w-[60ch] gap-2">
        <span className={eyebrow}>{say(lang, v.eyebrow)}</span>
        <h2
          className={`${serif} m-0 text-[clamp(28px,4vw,42px)] !leading-tight`}
        >
          {say(lang, v.title)}
        </h2>
        <p className={`m-0 ${muted}`}>{say(lang, v.lede)}</p>
      </div>
      <div className="grid gap-[18px] md:grid-cols-2">
        {items.map((it) => (
          <article
            key={it.role}
            className="grid min-w-0 gap-3.5 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-3.5"
          >
            <video
              src={it.video.src}
              poster={it.video.poster}
              controls
              playsInline
              preload="none"
              className="block aspect-video w-full max-w-full rounded-2xl bg-[#123b2e]"
            />
            <div className="grid gap-1 px-1.5 pb-1.5">
              <h3 className={`${serif} m-0 text-[22px]`}>
                {say(lang, it.label)}
              </h3>
              <p className={`m-0 text-sm ${muted}`}>{say(lang, it.text)}</p>
              <Link
                href={`/guide/${it.role}`}
                className="mt-1 inline-flex items-center gap-1.5 font-semibold !text-[var(--green)] no-underline"
              >
                {say(lang, v.all)} ({it.count}) <ArrowRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function MarketingHome() {
  const lang = useLang();
  const h = copy.home;
  return (
    <section className="py-10 sm:py-16">
      <div className={wrap}>
        <div className="grid items-center gap-8 lg:grid-cols-[1.05fr_.95fr] lg:gap-16">
          <div className="min-w-0">
            <span className={eyebrow}>{say(lang, h.eyebrow)}</span>
            <h1
              className={`${serif} mb-0 mt-3.5 text-[clamp(40px,6vw,70px)] !leading-[1.04]`}
            >
              {say(lang, h.titleA)}
              <em className="text-[var(--green)]">{say(lang, h.titleEm1)}</em>
              {say(lang, h.titleB)}
              <em className="text-[var(--green)]">{say(lang, h.titleEm2)}</em>.
            </h1>
            <p className={`mt-4 max-w-[54ch] text-lg ${muted}`}>
              {say(lang, h.lede)}
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/owners" className={btn()}>
                {say(lang, h.ctaOwner)}
              </Link>
              <Link href="/students" className={btn("outline")}>
                {say(lang, h.ctaStudent)}
              </Link>
            </div>
            <div
              className={`mt-7 flex flex-wrap gap-x-6 gap-y-2 text-sm ${muted}`}
            >
              {h.facts.map(([n, label]) => (
                <span key={n}>
                  <strong className="font-mono text-[var(--text)]">{n}</strong>{" "}
                  {say(lang, label)}
                </span>
              ))}
            </div>
          </div>
          <SeatMap />
        </div>

        <div className="mt-14 grid gap-[18px] md:grid-cols-2">
          {[
            [
              "/owners",
              h.ownerEyebrow,
              h.ownerTitle,
              copy.ownerWins,
              h.ownerGo,
            ],
            [
              "/students",
              h.studentEyebrow,
              h.studentTitle,
              copy.studentWins,
              h.studentGo,
            ],
          ].map(([href, eb, title, wins, go]) => (
            <Link
              key={href as string}
              href={href as string}
              className="group grid min-w-0 content-start gap-3 rounded-[20px] border border-[var(--line)] bg-[var(--surface)] p-6 text-[var(--text)] no-underline transition hover:-translate-y-0.5 hover:border-[var(--green)]"
            >
              <span className={eyebrow}>
                {say(lang, eb as typeof h.ownerEyebrow)}
              </span>
              <h2 className={`${serif} m-0 text-[28px] !leading-tight`}>
                {say(lang, title as typeof h.ownerTitle)}
              </h2>
              <Wins list={wins as typeof copy.ownerWins} />
              <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--green)]">
                {say(lang, go as typeof h.ownerGo)}{" "}
                <ArrowRight
                  size={16}
                  className="transition group-hover:translate-x-1"
                />
              </span>
            </Link>
          ))}
        </div>
        <div className="mt-[18px] grid gap-[18px] lg:grid-cols-3">
          {h.strip.map(([href, title, text]) => (
            <Link
              key={href}
              href={href}
              className="grid min-w-0 gap-1.5 rounded-2xl bg-[var(--soft)] p-5 text-[var(--text)] no-underline hover:outline hover:outline-1 hover:outline-[var(--green)]"
            >
              <strong>{say(lang, title)}</strong>
              <span className={`text-sm ${muted}`}>{say(lang, text)}</span>
            </Link>
          ))}
        </div>
        <HomeVideos />
        <MarketingCta />
      </div>
    </section>
  );
}

/* ───────────── Shared pieces ───────────── */

function PageHead({
  crumb,
  title,
  lede,
}: {
  crumb: typeof copy.nav.home;
  title: typeof copy.nav.home;
  lede: typeof copy.nav.home;
}) {
  const lang = useLang();
  return (
    <div className="mb-9 grid max-w-[66ch] gap-3">
      <nav aria-label="Breadcrumb" className={`text-sm ${muted}`}>
        <Link href="/" className="text-[var(--green)] no-underline">
          {say(lang, copy.nav.home)}
        </Link>{" "}
        / {say(lang, crumb)}
      </nav>
      <h1
        className={`${serif} m-0 text-[clamp(34px,5vw,56px)] !leading-[1.08]`}
      >
        {say(lang, title)}
      </h1>
      <p className={`m-0 text-[17px] ${muted}`}>{say(lang, lede)}</p>
    </div>
  );
}

function MarketingCta() {
  const lang = useLang();
  const c = copy.cta;
  return (
    <div className="mt-14 grid items-center gap-5 rounded-[22px] bg-[var(--green)] p-6 text-white sm:p-10 md:grid-cols-[1.4fr_auto]">
      <div className="min-w-0">
        <h2 className={`${serif} m-0 text-[clamp(26px,3.4vw,38px)]`}>
          {say(lang, c.title)}
        </h2>
        <p className="mb-0 mt-1.5 opacity-90">{say(lang, c.text)}</p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/register"
          className={`${buttonVariants({ size: "lg" })} h-12 rounded-xl bg-white px-5 text-[15px] !text-[#20745b] no-underline hover:bg-white/90`}
        >
          {say(lang, c.owner)}
        </Link>
        <Link
          href="/register"
          className={`${buttonVariants({ variant: "outline", size: "lg" })} h-12 rounded-xl border-white bg-transparent px-5 text-[15px] !text-white no-underline hover:bg-white/10`}
        >
          {say(lang, c.student)}
        </Link>
      </div>
    </div>
  );
}

const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function FeatureList({
  groups,
  role,
}: {
  groups: FeatureGroup[];
  role: "owner" | "student";
}) {
  const lang = useLang();
  const videos: GuideVideo[] = role === "owner" ? ownerGuide : studentGuide;
  return (
    <div className="grid min-w-0 gap-8">
      {groups.map((grp) => (
        <div key={grp.name.en}>
          <h3
            className={`m-0 mb-1.5 flex items-center gap-2.5 text-xs font-semibold uppercase tracking-[0.14em] ${muted} after:h-px after:flex-1 after:bg-[var(--line)] after:content-['']`}
          >
            {say(lang, grp.name)} · {grp.items.length}
          </h3>
          <div className="grid gap-x-7 sm:grid-cols-2">
            {grp.items.map((f) => (
              <div
                key={f.name.en}
                className="min-w-0 border-b border-[var(--line)] py-3"
              >
                <strong className="block text-[15px]">
                  {say(lang, f.name)}
                </strong>
                <span
                  className={`mt-0.5 block text-sm leading-normal ${muted}`}
                >
                  {say(lang, f.text)}
                </span>
                <Link
                  href={`/guide/${role}/${f.guide}`}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-[13px] font-semibold !text-[var(--green)] no-underline hover:underline"
                >
                  <PlayCircle size={15} aria-hidden="true" />
                  {say(lang, copy.videos.watch)}
                  <span className={`font-normal ${muted}`}>
                    ·{" "}
                    {clock(
                      videos.find((v) => v.slug === f.guide)?.seconds ?? 0,
                    )}
                  </span>
                </Link>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FeaturePage({ who }: { who: "owners" | "students" }) {
  const lang = useLang();
  const c = copy[who];
  return (
    <section className="py-10 sm:py-16">
      <div className={wrap}>
        <PageHead crumb={copy.nav[who]} title={c.title} lede={c.lede} />
        <div className="grid items-start gap-8 lg:grid-cols-[1fr_2.1fr] lg:gap-14">
          <aside className="grid min-w-0 gap-3.5 rounded-[18px] bg-[var(--soft)] p-6 lg:sticky lg:top-24">
            <h2 className={`${serif} m-0 text-2xl !leading-tight`}>
              {say(lang, c.asideTitle)}
            </h2>
            <p className={`m-0 text-[15px] ${muted}`}>
              {say(lang, c.asideText)}
            </p>
            <Wins list={who === "owners" ? copy.ownerWins : copy.studentWins} />
            <Link href="/how-it-works" className={btn()}>
              {say(lang, c.asideCta)}
            </Link>
          </aside>
          <FeatureList
            groups={who === "owners" ? ownerFeatures : studentFeatures}
            role={who === "owners" ? "owner" : "student"}
          />
        </div>
        <MarketingCta />
      </div>
    </section>
  );
}

export const MarketingOwners = () => <FeaturePage who="owners" />;
export const MarketingStudents = () => <FeaturePage who="students" />;

/* ───────────── How it works ───────────── */

export function MarketingHow() {
  const lang = useLang();
  const c = copy.how;
  return (
    <section className="py-10 sm:py-16">
      <div className={wrap}>
        <PageHead crumb={copy.nav.how} title={c.title} lede={c.lede} />
        <ol className="m-0 grid list-none gap-3.5 p-0">
          {dayFlow.map((s, i) => (
            <li
              key={s.tag}
              className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] px-5 py-4 sm:grid-cols-[44px_minmax(0,1fr)_auto]"
            >
              <span className="grid size-10 place-items-center rounded-full bg-[var(--green)] font-mono font-semibold text-white">
                {i + 1}
              </span>
              <div className="min-w-0">
                <span
                  className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${muted}`}
                >
                  {say(lang, s.who)}
                </span>
                <strong className="mt-0.5 block text-[17px]">
                  {say(lang, s.title)}
                </strong>
                <p className={`m-0 mt-0.5 text-sm ${muted}`}>
                  {say(lang, s.text)}
                </p>
              </div>
              <span className="col-start-2 justify-self-start whitespace-nowrap rounded-lg bg-[var(--soft)] px-2.5 py-2 font-mono text-[13px] font-semibold text-[var(--green)] sm:col-start-auto">
                {s.tag}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-5">
          <p className={`m-0 max-w-[60ch] ${muted}`}>{say(lang, c.note)}</p>
          <Link href="/guide" className={btn("outline")}>
            {say(lang, c.noteCta)}
          </Link>
        </div>
        <MarketingCta />
      </div>
    </section>
  );
}

/* ───────────── Coming soon ───────────── */

export function MarketingSoon() {
  const lang = useLang();
  const c = copy.soon;
  return (
    <section className="py-10 sm:py-16">
      <div className={wrap}>
        <PageHead crumb={copy.nav.soon} title={c.title} lede={c.lede} />
        <div className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,270px),1fr))]">
          {comingSoon.map((s) => (
            <article
              key={s.title.en}
              className="grid min-w-0 content-start gap-2.5 rounded-2xl border border-dashed border-[#9a6a12] bg-[#fbf3e2] p-5"
            >
              <div className="flex flex-wrap gap-1.5">
                {s.for.map((f) => (
                  <span
                    key={f.en}
                    className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-[#243e35]"
                  >
                    {say(lang, f)}
                  </span>
                ))}
                <span className="rounded-full border border-[#9a6a12] px-2.5 py-1.5 text-[11px] font-semibold uppercase leading-none tracking-[0.08em] text-[#9a6a12]">
                  {say(lang, s.stage)}
                </span>
              </div>
              <h2
                className={`${serif} m-0 text-[22px] !leading-tight text-[#243e35]`}
              >
                {say(lang, s.title)}
              </h2>
              <p className="m-0 text-sm text-[#586b5c]">{say(lang, s.text)}</p>
              <p className="m-0 text-sm font-medium text-[#243e35]">
                {say(lang, s.gain)}
              </p>
            </article>
          ))}
        </div>
        <MarketingCta />
      </div>
    </section>
  );
}

/** Which marketing page a path renders, or null. */
export function marketingPage(path: string) {
  switch (path) {
    case "/owners":
      return <MarketingOwners />;
    case "/students":
      return <MarketingStudents />;
    case "/how-it-works":
      return <MarketingHow />;
    case "/coming-soon":
      return <MarketingSoon />;
    default:
      return null;
  }
}
