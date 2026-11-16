"use client";

import Link from "next/link";
import { MODULES, isModuleKey } from "@/lib/modules";
import { NAV_ACCESS, STUDENT_PATH_MODULE } from "@/lib/permissions";
import type { Json } from "./prep-api";

type Blocked = { title: string; message: string } | null;
const REASON: Record<string, string> = {
  library: "It is turned off for this library.",
  platform: "It is not available for this library.",
  plan: "It is not included in this library's plan.",
  dependency: "Something it depends on is turned off.",
};

/** Why a screen is closed to this person, or null when it is open. Menus and pages both use this; the server enforces the same rules. */
export function navBlocked(path: string, access: Json | undefined, role: string | undefined): Blocked {
  if (!access || !access.modules) return null; // still loading, or not a library user: the server decides
  const states = access.modules as Record<string, { enabled: boolean; reason: string }>;
  const off = (key: string): Blocked => {
    if (!isModuleKey(key) || states[key]?.enabled) return null;
    return { title: `${MODULES[key].name} is not available`, message: `${REASON[states[key]?.reason] ?? ""} ${access.kind === "owner" && states[key]?.reason === "library" ? "You can turn it on under Modules." : ""}`.trim() };
  };
  if (role === "student") {
    if (path === "/app/events") return states.events?.enabled || states.feedback?.enabled ? null : off("events");
    const key = STUDENT_PATH_MODULE[path] ?? (path === "/app/punch" || path === "/app/check-in" ? "attendance" : undefined);
    return key ? off(key) : null;
  }
  const entry = NAV_ACCESS[path];
  if (!entry) return null;
  if (entry.ownerOnly && access.kind !== "owner") return { title: "Owner only", message: "Only the library owner can open this page." };
  if (entry.module) {
    const blocked = off(entry.module);
    if (blocked) return blocked;
  }
  if (entry.permission && access.kind !== "owner" && !(access.permissions as string[]).includes(entry.permission))
    return { title: "No access", message: "Your role does not include this page. Ask the owner if you need it." };
  return null;
}

export function filterNav<T extends [string, string, unknown]>(nav: T[], access: Json | undefined, role: string | undefined): T[] {
  return nav.filter(([href]) => !navBlocked(href, access, role));
}

export function AccessNotice({ blocked, home }: { blocked: NonNullable<Blocked>; home: string }) {
  return (
    <div className="empty" role="status">
      <h2>{blocked.title}</h2>
      <p>{blocked.message}</p>
      <Link className="button" href={home}>Back to the start</Link>
    </div>
  );
}
