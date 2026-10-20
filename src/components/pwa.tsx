"use client";

import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { rememberLibraryName } from "@/components/brand-loader";

/**
 * Drops everything the service worker cached and unregisters it. Called on sign-out and account deletion so a shared
 * device never keeps another person's pages. The worker only caches static assets, but this is defence in depth.
 */
export async function clearClientCaches() {
  rememberLibraryName(null);
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
    // While offline, a failed request would surface as the browser's raw "Failed to fetch"; say what happened instead.
    const original = window.fetch;
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      try { return await original(...args); }
      catch (error) {
        if (error instanceof TypeError && !navigator.onLine) throw new Error("You're offline. Reconnect and try again. Nothing was saved or confirmed.");
        throw error;
      }
    };
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => null);
    return () => { window.fetch = original; window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);
  if (online) return null;
  return <div className="sq-offline" role="status" aria-live="polite"><WifiOff size={14} /> <span>You&apos;re offline. Payments, quizzes and rewards need a connection.</span></div>;
}
