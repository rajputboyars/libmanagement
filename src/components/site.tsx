"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ArrowRight, BookOpen, Armchair, Flame, Clock3, ChartNoAxesCombined, Wallet, Search, Check, X, Sun, Moon, ShieldCheck, Leaf, Building2, CheckCircle2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Empty, Garden } from "@/components/ui-bits";

export function PublicPage({
  path,
  dark,
  toggle,
}: {
  path: string;
  dark: boolean;
  toggle: () => void;
}) {
  const [demo, setDemo] = useState(false);
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
      <header className="public-header">
        <Link href="/" className="brand">
          <span className="brand-mark">✳</span>StudyQuest
          <span className="brand-dot">.</span>
        </Link>
        <nav>
          <Link
            className={path === "/features" ? "selected" : ""}
            href="/features"
          >
            Why StudyQuest
          </Link>
          <Link
            className={path === "/pricing" ? "selected" : ""}
            href="/pricing"
          >
            Pricing
          </Link>
          <Link href="/libraries">Find your space</Link>
        </nav>
        <div>
          <button
            className="icon-btn"
            onClick={toggle}
            aria-label="Toggle theme"
          >
            {dark ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <Link className="login-link" href="/login">
            Log in
          </Link>
          <Link className="button" href="/register">
            Get started <ArrowUpRight size={16} />
          </Link>
        </div>
      </header>
      <main>
        {path === "/" ? (
          <>
            <section className="landing-hero">
              <div className="landing-copy">
                <span className="pill">
                  <span className="status-dot" />A LITTLE FOCUS. A WORLD OF
                  POSSIBILITY.
                </span>
                <h1>
                  Great things
                  <br />
                  grow from
                  <br />
                  <em>small beginnings.</em>
                  <span className="heading-spark">✦</span>
                </h1>
                <p>
                  Your favourite place to focus. Your next chapter of growth.
                  <br />
                  Meet the study space that brings it all together.
                </p>
                <div className="hero-buttons">
                  <Link href="/register" className="button">
                    Find your focus <ArrowRight size={18} />
                  </Link>
                  <Link href="/owner" className="button secondary">
                    For library owners <ArrowUpRight size={17} />
                  </Link>
                </div>
                <div className="landing-proof">
                  <ShieldCheck size={18} />
                  <span>Your pace. Your progress. Always yours.</span>
                </div>
              </div>
              <div className="landing-art">
                <span className="art-label">GROW INTO YOUR POTENTIAL</span>
                <Garden />
                <div className="landing-float float-focus">
                  <span className="icon-tile mint">
                    <Clock3 size={20} />
                  </span>
                  <div>
                    <strong>A little more focused.</strong>
                    <small>One session at a time.</small>
                  </div>
                  <CheckCircle2 size={20} color="#26775e" />
                </div>
                <div className="landing-float float-streak">
                  <Flame size={25} color="#d58a4b" />
                  <div>
                    <strong>Good habits are growing.</strong>
                    <small>Show up. Get a little better.</small>
                  </div>
                </div>
                <div className="art-bottom">
                  <span>01 — INTENTION</span>
                  <span>02 — FOCUS</span>
                  <span>03 — GROWTH</span>
                </div>
              </div>
            </section>
            <div className="landing-strip">
              <span>LESS FRICTION. MORE POSSIBILITY.</span>
              <p>
                <BookOpen size={20} /> A smarter library
              </p>
              <p>
                <Clock3 size={20} /> A calmer study routine
              </p>
              <p>
                <Leaf size={20} /> A little growth, every day
              </p>
            </div>
            <section className="feature-section">
              <div className="center-heading">
                <span className="eyebrow">
                  DESIGNED AROUND YOUR NEXT CHAPTER
                </span>
                <h2>
                  One thoughtful space.
                  <br />
                  So many ways to grow.
                </h2>
                <p>
                  For ambitious students and the libraries that believe in them.
                </p>
              </div>
              <div className="feature-grid">
                {features.slice(0, 3).map((f) => (
                  <Feature key={f.title} {...f} />
                ))}
              </div>
              <div className="center-action">
                <Link href="/features" className="text-link">
                  Explore what’s possible <ArrowRight size={16} />
                </Link>
              </div>
            </section>
            <section className="owner-callout">
              <div>
                <span className="eyebrow">FOR THE PEOPLE BEHIND THE SPACE</span>
                <h2>
                  Less admin.
                  <br />
                  More room for ambition.
                </h2>
                <p>
                  Bring your seats, students, and payments into one calm,
                  <br />
                  clear workspace. Get back to building your community.
                </p>
                <Link className="button" href="/owner">
                  Explore the owner workspace <ArrowUpRight size={17} />
                </Link>
              </div>
              <div className="mini-workspace">
                <div className="mini-header">
                  <span className="brand-mark">✳</span>Your library, at a
                  glance.<span className="pill">ALL IN ONE PLACE</span>
                </div>
                <div className="mini-seats">
                  {Array.from({ length: 24 }, (_, i) => (
                    <span key={i} className={i % 4 === 0 ? "free" : ""}>
                      <Armchair size={21} />
                    </span>
                  ))}
                </div>
                <div className="mini-footer">
                  <span className="status-dot" /> A place for every student.{" "}
                  <ArrowUpRight size={17} />
                </div>
              </div>
            </section>
          </>
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
      </main>
      <footer className="public-footer">
        <Link className="brand" href="/">
          <span className="brand-mark">✳</span>StudyQuest.
        </Link>
        <p>Made for the person you’re becoming.</p>
        <div>
          <Link href="/features">Features</Link>
          <Link href="/pricing">Pricing</Link>
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
              Want a guided walkthrough? <Link href="/demo">Book a demo</Link> — we only contact you if you agree.
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
