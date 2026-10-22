"use client";

import Link from "next/link";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ListVideo, Play } from "lucide-react";
import {
  ownerGuide,
  studentGuide,
  type GuideRole,
  type GuideVideo,
} from "@/lib/guide-videos";

const lists: Record<GuideRole, GuideVideo[]> = {
  student: studentGuide,
  owner: ownerGuide,
};
const tabs: { role: GuideRole; label: string; hint: string }[] = [
  { role: "student", label: "Students ke liye", hint: "For students" },
  {
    role: "owner",
    label: "Library owners ke liye",
    hint: "For library owners",
  },
];
const clock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const totalMinutes = (v: GuideVideo[]) =>
  Math.round(v.reduce((n, x) => n + x.seconds, 0) / 60);

export function VideoGuide() {
  // useSearchParams needs a Suspense boundary so the page can still be prerendered.
  return (
    <Suspense fallback={<GuidePlayer initial="student" />}>
      <GuideFromQuery />
    </Suspense>
  );
}

function GuideFromQuery() {
  const initial: GuideRole =
    useSearchParams().get("for") === "owner" ? "owner" : "student";
  return <GuidePlayer key={initial} initial={initial} />;
}

function GuidePlayer({ initial }: { initial: GuideRole }) {
  const [role, setRole] = useState<GuideRole>(initial);
  const [index, setIndex] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);
  const [playAll, setPlayAll] = useState(false);
  const playerRef = useRef<HTMLDivElement>(null);
  const videos = lists[role];
  const current = videos[index];
  const open = (i: number, all = playAll) => {
    setIndex(i);
    setAutoPlay(true);
    setPlayAll(all);
    playerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="vg">
      <div className="vg-tabs" role="tablist" aria-label="Choose a guide">
        {tabs.map((t) => (
          <button
            key={t.role}
            role="tab"
            aria-selected={role === t.role}
            className={role === t.role ? "active" : ""}
            onClick={() => {
              setRole(t.role);
              setIndex(0);
              setAutoPlay(false);
              setPlayAll(false);
            }}
          >
            <span>{t.label}</span>
            <small>
              {t.hint} · {lists[t.role].length} videos ·{" "}
              {totalMinutes(lists[t.role])} min
            </small>
          </button>
        ))}
      </div>
      <div className="vg-player" ref={playerRef}>
        <video
          key={current.src}
          src={current.src}
          poster={current.poster}
          controls
          playsInline
          preload="none"
          autoPlay={autoPlay}
          onEnded={() => {
            if (playAll && index < videos.length - 1) open(index + 1, true);
            else setPlayAll(false);
          }}
        />
        <div className="vg-now">
          <div>
            <span className="eyebrow">
              {index + 1} / {videos.length} · {current.page}
            </span>
            <h2>{current.title}</h2>
            <p>{current.subtitle}</p>
          </div>
          <button className="button" onClick={() => open(0, true)}>
            <ListVideo size={17} />
            {playAll ? "Playing all…" : "Play all (full tour)"}
          </button>
        </div>
      </div>
      <ol className="vg-grid">
        {videos.map((v, i) => (
          <li key={v.src}>
            <button
              className={i === index ? "vg-card active" : "vg-card"}
              onClick={() => open(i)}
              aria-current={i === index ? "true" : undefined}
            >
              <span className="vg-thumb">
                {/* Plain img: posters are tiny static JPGs, no need for next/image processing. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={v.poster}
                  alt=""
                  loading="lazy"
                  width={320}
                  height={180}
                />
                <span className="vg-play" aria-hidden="true">
                  <Play size={18} fill="currentColor" />
                </span>
                <span className="vg-time">{clock(v.seconds)}</span>
              </span>
              <span className="vg-meta">
                <small>
                  {String(i + 1).padStart(2, "0")} · {v.page}
                </small>
                <strong>{v.title}</strong>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Home page teaser: the two Overview videos with links into the full guide. */
export function GuideTeaser() {
  const items: {
    role: GuideRole;
    label: string;
    text: string;
    video: GuideVideo;
  }[] = [
    {
      role: "student",
      label: "Students ke liye",
      text: "Padhai ka timer, XP, streak aur attendance.",
      video: studentGuide[0],
    },
    {
      role: "owner",
      label: "Library owners ke liye",
      text: "Seats, fees, attendance aur reports, ek jagah.",
      video: ownerGuide[0],
    },
  ];
  return (
    <section className="vg-teaser">
      <div className="center-heading">
        <span className="eyebrow">VIDEO GUIDE · HINDI AUDIO</span>
        <h2>Dekhiye kaise kaam karta hai</h2>
        <p>
          Short Hindi videos for every screen, for students and for library
          owners.
        </p>
      </div>
      <div className="vg-teaser-grid">
        {items.map((it) => (
          <article key={it.role} className="vg-teaser-card">
            <video
              src={it.video.src}
              poster={it.video.poster}
              controls
              playsInline
              preload="none"
            />
            <div>
              <h3>{it.label}</h3>
              <p>{it.text}</p>
              <Link className="text-link" href={`/guide?for=${it.role}`}>
                All {lists[it.role].length} videos <ArrowRight size={16} />
              </Link>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
