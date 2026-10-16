"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * Drops everything the service worker cached and unregisters it. Called on sign-out and account deletion so a shared
 * device never keeps another person's pages. The worker only caches static assets, but this is defence in depth.
 */
export async function clearClientCaches() {
  try {
    if ("caches" in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    const reg = await navigator.serviceWorker?.getRegistration();
    reg?.active?.postMessage({ type: "clear-caches" });
  } catch { /* best effort */ }
}

/** Registers the service worker (production only) and shows a banner when the network is unavailable. */
export function PwaRegister() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (online) return null;
  return <div className="sq-offline" role="status" aria-live="polite"><WifiOff size={14} /> You&apos;re offline. Payments, quizzes and study rewards need a connection; nothing is confirmed until you are back online.</div>;
}
