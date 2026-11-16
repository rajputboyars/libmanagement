"use client";
import { createContext, useCallback, useContext, useLayoutEffect, useState, useSyncExternalStore } from "react";

export type LayoutMode = "desktop" | "tablet" | "mobile";
/** Container-width breakpoints (px): below 768 mobile, below 1100 tablet. */
export const LAYOUT_BREAKPOINTS = { tablet: 768, desktop: 1100 } as const;

export const modeForWidth = (w: number): LayoutMode =>
  w < LAYOUT_BREAKPOINTS.tablet ? "mobile" : w < LAYOUT_BREAKPOINTS.desktop ? "tablet" : "desktop";

const LayoutContext = createContext<LayoutMode | null>(null);
export const LayoutProvider = LayoutContext.Provider;

const subscribeViewport = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const viewportMode = () => modeForWidth(window.innerWidth);

/**
 * The current layout mode. Inside a shell it is the shell's measured container width;
 * outside one it falls back to the viewport so primitives still work on their own.
 */
export function useLayoutMode(): LayoutMode {
  const ctx = useContext(LayoutContext);
  const viewport = useSyncExternalStore(subscribeViewport, viewportMode, () => "desktop" as LayoutMode);
  return ctx ?? viewport;
}

/** Shell-only: measures an element with ResizeObserver and returns a callback ref plus its mode. */
export function useMeasuredLayout<T extends HTMLElement>() {
  const [node, setNode] = useState<T | null>(null);
  const [mode, setMode] = useState<LayoutMode>("desktop");
  const ref = useCallback((el: T | null) => setNode(el), []);
  useLayoutEffect(() => {
    if (!node) return;
    const measure = () => setMode(modeForWidth(node.getBoundingClientRect().width));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [node]);
  return { ref, mode };
}
