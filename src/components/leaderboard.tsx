"use client";

import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy } from "lucide-react";
import { BrandLoader } from "@/components/brand-loader";
import { getJson, post, type Json } from "./prep-api";

const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);

/** Opt-in leaderboard of focused study time this week inside the student's own library. */
export function Leaderboard({ notify }: { notify: (m: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery<Json>({ queryKey: ["leaderboard"], queryFn: () => getJson("/api/leaderboard") });
  const [busy, setBusy] = useState(false);
  if (q.isLoading) return <BrandLoader compact text="Counting this week's hours…" />;
  if (q.isError || !q.data) return <div className="mt-empty"><h2>Could not load the leaderboard</h2><p>{q.error instanceof Error ? q.error.message : "Try again."}</p></div>;
  const d = q.data;
  const save = async (join: boolean, name?: string) => {
    setBusy(true);
    try {
      await post("/api/leaderboard", "save", { join, name });
      await qc.invalidateQueries({ queryKey: ["leaderboard"] });
      notify(join ? "You're on the leaderboard." : "You left the leaderboard.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void save(true, String(new FormData(e.currentTarget).get("name") ?? ""));
  };
  const top = d.top as Json[];
  return (
    <div className="board-page">
      <header className="p2-heading">
        <div>
          <span className="eyebrow">Library leaderboard</span>
          <h1>Who studied most this week.</h1>
          <p>Only students who choose to join appear here, under the name they pick. It counts completed focus sessions since Monday, and resets every week.</p>
        </div>
      </header>
      {!d.hasLibrary ? (
        <div className="mt-empty"><h2>Join a library first</h2><p>The leaderboard compares you with students of your own library.</p></div>
      ) : (
        <>
          <section className="card board-join">
            {d.joined ? (
              <>
                <p>You appear as <strong>{d.name}</strong>.</p>
                <form className="board-name" onSubmit={submit}>
                  <input name="name" defaultValue={d.name} maxLength={24} minLength={2} aria-label="Display name" />
                  <button className="button secondary" disabled={busy}>Change name</button>
                  <button type="button" className="text-link" disabled={busy} onClick={() => save(false)}>Leave leaderboard</button>
                </form>
              </>
            ) : (
              <>
                <p>Join to see your rank. Choose the name others will see; your real name, email and phone stay private.</p>
                <form className="board-name" onSubmit={submit}>
                  <input name="name" defaultValue={d.name} maxLength={24} minLength={2} required aria-label="Display name" />
                  <button className="button" disabled={busy}><Trophy size={16} /> Join leaderboard</button>
                </form>
              </>
            )}
          </section>
          <section className="card" style={{ marginTop: 20 }}>
            <div className="section-heading">
              <h2>This week</h2>
              <span className="pill">{d.players} {d.players === 1 ? "player" : "players"}</span>
            </div>
            {top.length ? (
              <ol className="board-list">
                {top.map((r, i) => (
                  <li key={`${r.rank}-${i}`} className={r.me ? "me" : ""}>
                    <span className={`board-rank r${r.rank}`}>{r.rank}</span>
                    <strong>{r.name}{r.me ? " (you)" : ""}</strong>
                    <span className="board-time">{hm(r.minutes)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Nobody has joined yet. Be the first.</p>
            )}
            {d.mine && !top.some((r) => r.me) && (
              <p className="board-mine">Your rank: <strong>#{d.mine.rank}</strong> · {hm(d.mine.minutes)}</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
