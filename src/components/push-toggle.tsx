"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { getJson, post } from "./prep-api";

function urlBase64ToBytes(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

type State = "loading" | "unsupported" | "blocked" | "off" | "on" | "not-configured";

/** Turn phone notifications on or off for this device. */
export function PushToggle({ notify }: { notify: (m: string) => void }) {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
      try {
        const info = await getJson<{ publicKey: string | null }>("/api/push");
        if (!alive) return;
        if (!info.publicKey) return setState("not-configured");
        setKey(info.publicKey);
        if (Notification.permission === "denied") return setState("blocked");
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        setState(sub ? "on" : "off");
      } catch {
        if (alive) setState("unsupported");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  async function turnOn() {
    if (!key) return;
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return notify("Notifications were not allowed.");
      }
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(key) });
      await post("/api/push", "subscribe", sub.toJSON());
      setState("on");
      notify("Phone notifications are on.");
    } catch (e) {
      notify(e instanceof Error ? e.message : "Could not turn on notifications");
    } finally {
      setBusy(false);
    }
  }
  async function turnOff() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await post("/api/push", "unsubscribe", sub.toJSON()).catch(() => {});
        await sub.unsubscribe();
      }
      setState("off");
      notify("Phone notifications are off on this device.");
    } finally {
      setBusy(false);
    }
  }
  const text: Record<State, string> = {
    loading: "Checking this device…",
    unsupported: "This browser can't show phone notifications. On iPhone, add StudyQuest to your home screen first (iOS 16.4 or newer).",
    blocked: "Notifications are blocked for StudyQuest. Allow them in your phone's browser or app settings, then come back.",
    off: "Get fee reminders, announcements and seat offers on your phone, even when the app is closed.",
    on: "This device gets phone notifications.",
    "not-configured": "Phone notifications are not set up on this server yet.",
  };
  return (
    <section className="card push-toggle" style={{ marginTop: 20 }}>
      <div className="section-heading">
        <h2>Phone notifications</h2>
        {state === "on" ? <Bell size={20} /> : <BellOff size={20} />}
      </div>
      <p className="muted">{text[state]}</p>
      {state === "off" && (
        <button className="button" disabled={busy} onClick={turnOn}>
          <Bell size={17} /> Turn on notifications
        </button>
      )}
      {state === "on" && (
        <div className="queue-actions">
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              try {
                await post("/api/push", "test");
                notify("Test sent. Check your phone.");
              } catch (e) {
                notify(e instanceof Error ? e.message : "Could not send");
              }
            }}
          >
            Send a test
          </button>
          <button className="button secondary" disabled={busy} onClick={turnOff}>
            Turn off on this device
          </button>
        </div>
      )}
    </section>
  );
}
