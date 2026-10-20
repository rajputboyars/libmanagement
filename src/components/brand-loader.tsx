"use client";

import { useSyncExternalStore } from "react";

// The owner's library name is remembered in this browser so the next loading screen
// can show it before any data arrives. It is only a display convenience.
const KEY = "sq-library-name";
const EVENT = "sq-library-name";

function readName() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
export function rememberLibraryName(name: string | null) {
  try {
    if (name) localStorage.setItem(KEY, name);
    else localStorage.removeItem(KEY);
  } catch {}
  window.dispatchEvent(new Event(EVENT));
}

// Pure CSS animation so it also works in loading screens before the page is interactive.
export function BrandLoader({
  name,
  text = "Getting your space ready…",
  compact = false,
}: {
  name?: string;
  text?: string;
  compact?: boolean;
}) {
  const stored = useSyncExternalStore(subscribe, readName, () => null);
  const word = (name || stored || "StudyQuest").trim();
  return (
    <div className={compact ? "brand-loader compact" : "brand-loader"} role="status" aria-live="polite">
      <div className="brand-loader-word" aria-hidden="true">
        {[...word].map((letter, i) => (
          <span key={i} style={{ animationDelay: `${i * 0.08}s` }}>
            {letter === " " ? " " : letter}
          </span>
        ))}
        <span className="brand-loader-dot" style={{ animationDelay: `${word.length * 0.08}s` }}>.</span>
      </div>
      <p>{text}</p>
    </div>
  );
}
