"use client";
import { Bell, CalendarDays, ChevronRight, HelpCircle, LogOut, Menu, Moon, Settings, Sun, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LegalBanner } from "../legal-consent";
import { ResponsiveDialog } from "./dialog";
import { LayoutProvider, useMeasuredLayout, type LayoutMode } from "./layout";
import { MOBILE_PRIMARY_COUNT, NAV_GROUPS, PRIMARY_NAV, RAIL_PRIMARY_COUNT, groupNav, pickPrimary, type Role } from "./nav-config";

export type NavItem = [string, string, LucideIcon];

export type ShellProps = {
  path: string;
  /** Already filtered by modules and permissions; the shell never widens it. */
  nav: NavItem[];
  lockedPaths?: Set<string>;
  title: string;
  crumbRoot: string;
  workspaceName: string;
  workspaceSub?: string;
  profileHref: string;
  notificationsHref?: string;
  unread?: boolean;
  dark: boolean;
  onToggleTheme: () => void;
  userName: string;
  userSub: string;
  onSignOut: () => void;
  helpHref: string;
  showSettings?: boolean;
  /** Extra sidebar content (branch switcher, library ID). Shown in the sidebar on desktop and on the More screen elsewhere. */
  extra?: ReactNode;
  promo?: ReactNode;
  children: ReactNode;
};

type CoreProps = ShellProps & { role: Role; home: string };

function NavLink({ item, path, locked, onNavigate }: { item: NavItem; path: string; locked?: boolean; onNavigate?: () => void }) {
  const [href, label, Icon] = item;
  return (
    <Link href={href} className="sq-v2-link" aria-current={path === href ? "page" : undefined} onClick={onNavigate}>
      <Icon size={19} aria-hidden="true" />
      <span>{label}</span>
      {locked && (
        <span className="sq-v2-lock" title="Premium: clear your fees to unlock" role="img" aria-label="locked">
          🔒
        </span>
      )}
    </Link>
  );
}

function MoreScreen({ open, onClose, p, mode, primary }: { open: boolean; onClose: () => void; p: CoreProps; mode: LayoutMode; primary: NavItem[] }) {
  const shown = p.nav.filter((n) => !primary.includes(n));
  return (
    <ResponsiveDialog open={open} onClose={onClose} title="More" description={p.workspaceName} full>
      {p.extra && <div className="sq-v2-extra">{p.extra}</div>}
      {groupNav(shown, NAV_GROUPS[p.role]).map((g) => (
        <section key={g.label || "top"} aria-label={g.label || "Pages"} style={{ marginBottom: 14 }}>
          {g.label && <div className="sq-v2-label" style={{ paddingInline: 2 }}>{g.label.toUpperCase()}</div>}
          <div className="sq-v2-tiles">
            {g.items.map((item) => {
              const Icon = item[2];
              return (
                <Link key={item[0]} href={item[0]} className="sq-v2-tile" aria-current={p.path === item[0] ? "page" : undefined} onClick={onClose}>
                  <Icon size={22} aria-hidden="true" />
                  {item[1]}
                  {p.lockedPaths?.has(item[0]) && <span aria-label="locked">🔒</span>}
                </Link>
              );
            })}
          </div>
        </section>
      ))}
      <div className="sq-v2-label" style={{ paddingInline: 2 }}>ACCOUNT</div>
      <div className="sq-v2-tiles" aria-label={`Account (${mode})`}>
        {p.showSettings && !p.nav.some((n) => n[0] === p.profileHref) && (
          <Link href={p.profileHref} className="sq-v2-tile" onClick={onClose}>
            <Settings size={22} aria-hidden="true" />
            Settings
          </Link>
        )}
        <Link href={p.helpHref} className="sq-v2-tile" onClick={onClose}>
          <HelpCircle size={22} aria-hidden="true" />
          Help &amp; resources
        </Link>
        <button type="button" className="sq-v2-tile" onClick={p.onToggleTheme}>
          {p.dark ? <Sun size={22} aria-hidden="true" /> : <Moon size={22} aria-hidden="true" />}
          {p.dark ? "Light theme" : "Dark theme"}
        </button>
        <button type="button" className="sq-v2-tile" onClick={p.onSignOut}>
          <LogOut size={22} aria-hidden="true" />
          Sign out
        </button>
      </div>
    </ResponsiveDialog>
  );
}

/** Responsive frame shared by every role: desktop sidebar, tablet labelled rail, mobile bottom navigation + More screen. */
export function AppShell(p: CoreProps) {
  const { ref, mode } = useMeasuredLayout<HTMLDivElement>();
  const [more, setMore] = useState(false);
  const primary = pickPrimary(p.nav, PRIMARY_NAV[p.role], mode === "mobile" ? MOBILE_PRIMARY_COUNT : RAIL_PRIMARY_COUNT);
  const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  const initial = (p.userName || "S").slice(0, 1);
  return (
    <LayoutProvider value={mode}>
      <div ref={ref} className="sq-v2" data-layout={mode} data-sq-theme={p.role === "admin" ? "admin" : "light"} data-role={p.role}>
        <aside className="sq-v2-nav" aria-label="Primary">
          <Link className="sq-v2-brand" href="/">
            <i aria-hidden="true">✳</i>
            <span>StudyQuest</span>
          </Link>
          {mode === "desktop" && (
            <>
              <Link className="sq-v2-workspace" href={p.profileHref}>
                <strong>{p.workspaceName}</strong>
                {p.workspaceSub && <small>{p.workspaceSub}</small>}
              </Link>
              {p.extra && <div className="sq-v2-extra">{p.extra}</div>}
              <nav aria-label={p.workspaceName}>
                {groupNav(p.nav, NAV_GROUPS[p.role]).map((g) => (
                  <div key={g.label || "top"} role="group" aria-label={g.label || undefined}>
                    {g.label && <div className="sq-v2-label">{g.label.toUpperCase()}</div>}
                    {g.items.map((item) => (
                      <NavLink key={item[0]} item={item} path={p.path} locked={p.lockedPaths?.has(item[0])} />
                    ))}
                  </div>
                ))}
              </nav>
              <div className="sq-v2-grow" />
              {p.promo}
              {p.showSettings && (
                <Link className="sq-v2-link" href={p.profileHref}>
                  <Settings size={19} aria-hidden="true" />
                  <span>Settings</span>
                </Link>
              )}
              <Link className="sq-v2-link" href={p.helpHref}>
                <HelpCircle size={19} aria-hidden="true" />
                <span>Help &amp; resources</span>
              </Link>
              <div className="sq-v2-profile">
                <span className="sq-v2-avatar" aria-hidden="true">
                  {initial}
                </span>
                <div>
                  <strong>{p.userName}</strong>
                  <small>{p.userSub}</small>
                </div>
                <button type="button" className="sq-v2-iconbtn" aria-label="Sign out" onClick={p.onSignOut}>
                  <LogOut size={17} />
                </button>
              </div>
            </>
          )}
          {mode === "tablet" && (
            <>
              <nav aria-label={p.workspaceName}>
                {primary.map((item) => (
                  <NavLink key={item[0]} item={item} path={p.path} locked={p.lockedPaths?.has(item[0])} />
                ))}
              </nav>
              <button type="button" className="sq-v2-link" onClick={() => setMore(true)} aria-haspopup="dialog">
                <Menu size={19} aria-hidden="true" />
                <span>More</span>
              </button>
            </>
          )}
        </aside>
        <div className="sq-v2-col">
          <header className="sq-v2-top">
            <div className="sq-v2-crumb">
              {mode !== "mobile" && (
                <>
                  <span>{p.crumbRoot}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                </>
              )}
              <strong>{p.title}</strong>
            </div>
            <div className="sq-v2-actions">
              {p.role === "admin" && <span className="sq-v2-pill-admin">Platform admin</span>}
              <span className="sq-v2-today">
                <CalendarDays size={15} aria-hidden="true" />
                {today}
              </span>
              {mode !== "mobile" && (
                <button type="button" className="sq-v2-iconbtn" aria-label="Toggle color theme" onClick={p.onToggleTheme}>
                  {p.dark ? <Sun size={19} /> : <Moon size={19} />}
                </button>
              )}
              {p.notificationsHref && (
                <Link className="sq-v2-iconbtn" aria-label={p.unread ? "Notifications (unread)" : "Notifications"} href={p.notificationsHref}>
                  <Bell size={20} />
                  {p.unread && <i />}
                </Link>
              )}
              <Link className="sq-v2-avatar" href={p.profileHref} aria-label="Open my profile">
                {initial}
              </Link>
            </div>
          </header>
          <div className="sq-v2-content"><LegalBanner />{p.children}</div>
        </div>
        {mode === "mobile" && (
          <nav className="sq-v2-bottom" aria-label="Main">
            {primary.map((item) => (
              <NavLink key={item[0]} item={item} path={p.path} locked={p.lockedPaths?.has(item[0])} />
            ))}
            <button type="button" className="sq-v2-link" onClick={() => setMore(true)} aria-haspopup="dialog">
              <Menu size={21} aria-hidden="true" />
              <span>More</span>
            </button>
          </nav>
        )}
        <MoreScreen open={more && mode !== "desktop"} onClose={() => setMore(false)} p={p} mode={mode} primary={primary} />
      </div>
    </LayoutProvider>
  );
}

type RoleShellProps = Omit<ShellProps, "crumbRoot" | "helpHref" | "showSettings"> & Partial<Pick<ShellProps, "crumbRoot" | "helpHref" | "showSettings">>;

export const OwnerShell = (p: RoleShellProps) => (
  <AppShell {...p} role="owner" home="/owner" crumbRoot={p.crumbRoot ?? "Workspace"} helpHref={p.helpHref ?? "/guide?for=owner"} showSettings={p.showSettings ?? true} />
);
export const StudentShell = (p: RoleShellProps) => (
  <AppShell {...p} role="student" home="/app" crumbRoot={p.crumbRoot ?? "My study space"} helpHref={p.helpHref ?? "/guide?for=student"} showSettings={p.showSettings ?? true} />
);
export const AdminShell = (p: RoleShellProps) => (
  <AppShell {...p} role="admin" home="/super-admin" crumbRoot={p.crumbRoot ?? "Platform"} helpHref={p.helpHref ?? "/features"} showSettings={p.showSettings ?? false} />
);
