"use client";

import { BrandLoader } from "@/components/brand-loader";
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { PublicPage } from "@/components/site";
import { Auth, DemoPage, ForgotPassword, LibraryDiscovery, ResetPassword, SandboxCheckout, SaasPricing } from "@/components/lazy";
import { useUI } from "@/lib/ui-store";

// The signed-in workspace (dashboards, charts, forms) is a separate chunk that public pages never download.
const Workspace = dynamic(() => import("@/components/experience").then((m) => m.Experience), { loading: () => <main className="loading"><BrandLoader /></main> });

const PUBLIC_ROUTES = new Set(["/", "/features", "/guide", "/login", "/register", "/pricing", "/demo", "/discover", "/forgot-password", "/reset-password"]);
export const isPublicRoute = (path: string) => PUBLIC_ROUTES.has(path) || path.startsWith("/guide/") || path.startsWith("/billing/sandbox/");

export function AppEntry({ path }: { path: string }) {
  const { dark } = useUI();
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  if (!isPublicRoute(path)) return <Workspace path={path} />;
  if (path === "/login" || path === "/register") return <Auth register={path === "/register"} />;
  if (path === "/discover") return <LibraryDiscovery />;
  if (path === "/pricing") return <SaasPricing />;
  if (path === "/demo") return <DemoPage />;
  if (path === "/forgot-password") return <ForgotPassword />;
  if (path === "/reset-password") return <ResetPassword />;
  if (path.startsWith("/billing/sandbox/")) return <SandboxCheckout id={path.split("/")[3] ?? ""} />;
  return <PublicPage path={path} />;
}
