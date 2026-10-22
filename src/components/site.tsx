"use client";
import Link from "next/link";
import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Menu,
  Armchair,
  Clock3,
  ChartNoAxesCombined,
  Wallet,
  Search,
  Check,
  X,
  Sun,
  Moon,
  ShieldCheck,
  Leaf,
  Building2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Empty } from "@/components/ui-bits";
import { useUI } from "@/lib/ui-store";
import { copy, say } from "@/lib/site-copy";
import { MarketingHome, marketingPage } from "@/components/marketing";
import { VideoGuide } from "@/components/video-guide";
import {
  GuideDetail,
  GuideHubCards,
  GuidePortal,
} from "@/components/guide-site";
import { guideRoute } from "@/lib/guide-route";

export function PublicPage({ path }: { path: string }) {
  const [demo, setDemo] = useState(false);
  const guide = guideRoute(path);
  const lang = useUI((st) => st.lang);
  const marketing = marketingPage(path);
  // The new marketing pages (home, owners, students, how it works, coming soon) carry their own call to action.
  const ownCta = path === "/" || marketing !== null;
  const features = [
    {
      icon: Armchair,
      title: "A space for every ambition",
      text: "Seats, shifts, and memberships that work around your community.",
    },
    {
      icon: Clock3,
      title: "Make room for deep work",
      text: "A gentle focus timer that turns intention into a daily habit.",
    },
    {
      icon: Leaf,
      title: "Watch your effort grow",
      text: "Thoughtful quests, meaningful milestones, and progress you can see.",
    },
    {
      icon: Wallet,
      title: "Clarity, down to the last rupee",
      text: "Record confirmed payments, track dues, and understand your library.",
    },
    {
      icon: ShieldCheck,
      title: "Your community, protected",
      text: "Independent library workspaces and private student profiles.",
    },
    {
      icon: ChartNoAxesCombined,
      title: "The bigger picture, beautifully clear",
      text: "Understand your study rhythm and make every little win visible.",
    },
  ];
  return (
    <div className="public">
      <PublicHeader path={path} />
      <main>
        {path === "/" ? (
          <MarketingHome />
        ) : marketing ? (
          marketing
        ) : path === "/features" ? (
          <section className="feature-section">
            <div className="center-heading">
              <span className="eyebrow">LESS NOISE. MORE MOMENTUM.</span>
              <h1>
                Thoughtfully built.
                <br />
                For the way you grow.
              </h1>
              <p>Everything you need to make a little more of every day.</p>
            </div>
            <div className="feature-grid">
              {features.map((f) => (
                <Feature key={f.title} {...f} />
              ))}
            </div>
          </section>
        ) : path === "/pricing" ? (
          <section className="feature-section">
            <div className="center-heading">
              <span className="eyebrow">START SMALL. GROW AT YOUR PACE.</span>
              <h1>Room for every ambition.</h1>
              <p>
                Student study mode is free. Library pricing is tailored to your
                space.
              </p>
            </div>
            <div className="pricing-grid">
              {[
                {
                  name: "For students",
                  price: "Free",
                  items: [
                    "Personal focus room",
                    "XP & achievements",
                    "Study progress & goals",
                    "Private by default",
                  ],
                  cta: "Create your study space",
                  href: "/register",
                },
                {
                  name: "For libraries",
                  price: "Let’s talk",
                  items: [
                    "Seat & shift management",
                    "Student memberships",
                    "Cash & UPI records",
                    "Attendance & library reports",
                  ],
                  cta: "Request a walkthrough",
                  href: "",
                },
              ].map((p) => (
                <section className="card pricing-card" key={p.name}>
                  <span className="eyebrow">{p.name}</span>
                  <h2>{p.price}</h2>
                  <p>More focus. Less friction.</p>
                  {p.items.map((i) => (
                    <div className="pricing-item" key={i}>
                      <Check size={17} />
                      {i}
                    </div>
                  ))}
                  {p.href ? (
                    <Link className="button" href={p.href}>
                      {p.cta}
                      <ArrowRight size={16} />
                    </Link>
                  ) : (
                    <button className="button" onClick={() => setDemo(true)}>
                      {p.cta}
                      <ArrowRight size={16} />
                    </button>
                  )}
                </section>
              ))}
            </div>
          </section>
        ) : path === "/guide" ? (
          <section className="feature-section">
            <div className="center-heading">
              <span className="eyebrow">VIDEO GUIDE · HINDI AUDIO</span>
              <h1>Har screen, aasaan bhasha mein</h1>
              <p>
                Short Hindi videos that explain every page of StudyQuest, for
                students and for library owners.
              </p>
            </div>
            <GuideHubCards />
            <h2 className="vg-all-heading">All videos</h2>
            <VideoGuide />
          </section>
        ) : guide ? (
          guide.slug ? (
            <GuideDetail role={guide.role} slug={guide.slug} />
          ) : (
            <GuidePortal role={guide.role} />
          )
        ) : path === "/libraries" ? (
          <section className="feature-section">
            <div className="center-heading">
              <span className="eyebrow">
                FIND YOUR LITTLE CORNER OF POSSIBILITY
              </span>
              <h1>Your next favourite study spot.</h1>
              <p>
                Library discovery is growing. Your personal study space is ready
                today.
              </p>
            </div>
            <div className="card discovery">
              <Empty
                icon={Building2}
                title="Great spaces are on their way."
                text="A public library directory is not available yet. Already a member? Register with your email and ask your library to connect your account."
              />
              <Link href="/register" className="button">
                Start studying today <ArrowRight size={16} />
              </Link>
            </div>
          </section>
        ) : (
          <section className="feature-section">
            <Empty
              icon={Search}
              title="This chapter hasn’t been written."
              text="Let’s get you back to a familiar place."
            />
            <div className="center-action">
              <Link href="/" className="button">
                Back to home
              </Link>
            </div>
          </section>
        )}
        {!ownCta && (
          <section className="public-cta">
            <span>✳</span>
            <h2>
              Your next chapter
              <br />
              starts with a little focus.
            </h2>
            <Link className="button" href="/register">
              Make room for great things <ArrowRight size={17} />
            </Link>
            <p>Small steps. Your pace. A bigger future.</p>
          </section>
        )}
      </main>
      <footer className="public-footer">
        <Link className="brand" href="/">
          <span className="brand-mark">✳</span>StudyQuest.
        </Link>
        <p>{say(lang, copy.footer)}</p>
        <div>
          <Link href="/owners">{say(lang, copy.nav.owners)}</Link>
          <Link href="/students">{say(lang, copy.nav.students)}</Link>
          <Link href="/how-it-works">{say(lang, copy.nav.how)}</Link>
          <Link href="/coming-soon">{say(lang, copy.nav.soon)}</Link>
          <Link href="/pricing">{say(lang, copy.nav.pricing)}</Link>
          <Link href="/guide">{say(lang, copy.nav.guide)}</Link>
          <button className="text-link" onClick={() => setDemo(true)}>
            Request a demo
          </button>
        </div>
        <small>© {new Date().getFullYear()} StudyQuest</small>
      </footer>
      {demo && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="demo-title"
          >
            <div className="section-heading">
              <h2 id="demo-title">Meet your next workspace.</h2>
              <button
                className="icon-btn"
                aria-label="Close"
                onClick={() => setDemo(false)}
              >
                <X />
              </button>
            </div>
            <p className="muted">
              Explore the working owner preview, or create an owner account to
              set up your library.
            </p>
            <Link className="button" href="/owner">
              Explore owner preview <ArrowRight size={16} />
            </Link>
            <Link className="button secondary" href="/register">
              Create an account
            </Link>
            <p className="tiny muted">
              Want a guided walkthrough? <Link href="/demo">Book a demo</Link> —
              we only contact you if you agree.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
function Feature({
  icon: Icon,
  title,
  text,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <section className="feature">
      <span className="icon-tile mint">
        <Icon size={25} />
      </span>
      <h3>{title}</h3>
      <p>{text}</p>
    </section>
  );
}

const publicLinks: [string, keyof typeof copy.nav][] = [
  ["/owners", "owners"],
  ["/students", "students"],
  ["/how-it-works", "how"],
  ["/coming-soon", "soon"],
  ["/pricing", "pricing"],
  ["/guide", "guide"],
];

function LangToggle({ className = "" }: { className?: string }) {
  const { lang, setLang } = useUI();
  return (
    <div
      className={`lang-toggle ${className}`}
      role="group"
      aria-label="Language"
    >
      {(["en", "hi"] as const).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => setLang(l)}
        >
          {l === "en" ? "EN" : "Hinglish"}
        </button>
      ))}
    </div>
  );
}

/** The one public-site header (desktop nav + phone hamburger drawer), shared by every public page. */
export function PublicHeader({ path }: { path: string }) {
  const { dark, toggle, lang } = useUI();
  const [navOpen, setNavOpen] = useState(false);
  const isOn = (href: string) =>
    href === "/guide" ? path.startsWith("/guide") : path === href;
  return (
    <>
      <header className="public-header">
        <Link href="/" className="brand">
          <span className="brand-mark">✳</span>StudyQuest
          <span className="brand-dot">.</span>
        </Link>
        <nav>
          {publicLinks.map(([href, key]) => (
            <Link
              key={href}
              className={isOn(href) ? "selected" : ""}
              href={href}
            >
              {say(lang, copy.nav[key])}
            </Link>
          ))}
        </nav>
        <div>
          <LangToggle className="lang-toggle-header" />
          <button
            className="icon-btn"
            onClick={toggle}
            aria-label="Toggle theme"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Link className="login-link" href="/login">
            {say(lang, copy.nav.login)}
          </Link>
          <Link className="button" href="/register">
            {say(lang, copy.nav.start)} <ArrowUpRight size={16} />
          </Link>
          <button
            type="button"
            className="icon-btn public-menu-btn"
            onClick={() => setNavOpen((o) => !o)}
            aria-label={navOpen ? "Close menu" : "Open menu"}
            aria-expanded={navOpen}
            aria-controls="public-drawer"
          >
            {navOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </header>
      {navOpen && (
        <div
          className="public-drawer-backdrop"
          onClick={() => setNavOpen(false)}
        >
          <nav
            id="public-drawer"
            className="public-drawer"
            aria-label="Main menu"
            onClick={(e) => e.stopPropagation()}
          >
            <LangToggle />
            {[
              ["/", "home"] as [string, keyof typeof copy.nav],
              ...publicLinks,
              ["/discover", "find"] as [string, keyof typeof copy.nav],
            ].map(([href, key]) => (
              <Link
                key={href}
                href={href}
                className={isOn(href) ? "selected" : ""}
                onClick={() => setNavOpen(false)}
              >
                {say(lang, copy.nav[key])}
              </Link>
            ))}
            <div className="public-drawer-actions">
              <button
                className="icon-btn"
                onClick={toggle}
                aria-label="Toggle theme"
              >
                {dark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <Link
                className="button secondary"
                href="/login"
                onClick={() => setNavOpen(false)}
              >
                {say(lang, copy.nav.login)}
              </Link>
              <Link
                className="button"
                href="/register"
                onClick={() => setNavOpen(false)}
              >
                {say(lang, copy.nav.start)}
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
