"use client";
import type { LucideIcon } from "lucide-react";
import { AlertTriangle, ArrowLeft, Plus } from "lucide-react";
import Link from "next/link";
import { useRef, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

type BtnKind = "primary" | "outline" | "danger" | "onhero";
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { kind?: BtnKind; href?: string };

/** Design-system button for new screens; legacy `.button` and shadcn Button remain for existing ones. */
export function Btn({ kind = "primary", href, children, className, ...rest }: BtnProps) {
  const cls = `sq-v2-btn${className ? " " + className : ""}`;
  if (href)
    return (
      <Link href={href} className={cls} data-kind={kind}>
        {children}
      </Link>
    );
  return (
    <button type="button" className={cls} data-kind={kind} {...rest}>
      {children}
    </button>
  );
}

export function PageHead({
  title,
  eyebrow,
  sub,
  back,
  actions,
}: {
  title: string;
  eyebrow?: string;
  sub?: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <div className="sq-v2-pagehead">
      <div>
        {back && (
          <Link href={back.href} className="sq-v2-back">
            <ArrowLeft size={15} /> {back.label}
          </Link>
        )}
        {eyebrow && <div className="sq-v2-eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {actions && <div className="sq-v2-btnrow">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
  onClick,
  href,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: "up" | "down";
  onClick?: () => void;
  href?: string;
}) {
  const body = (
    <>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </>
  );
  if (href)
    return (
      <Link href={href} className="sq-v2-stat" data-tone={tone}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" className="sq-v2-stat" data-tone={tone} onClick={onClick}>
        {body}
      </button>
    );
  return (
    <div className="sq-v2-stat" data-tone={tone}>
      {body}
    </div>
  );
}

export function HeroCard({
  title,
  text,
  metrics,
  actions,
}: {
  title: string;
  text?: string;
  metrics?: { label: string; value: ReactNode }[];
  actions?: ReactNode;
}) {
  return (
    <section className="sq-v2-hero">
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {metrics && metrics.length > 0 && (
        <div className="sq-v2-herometrics">
          {metrics.map((m) => (
            <div key={m.label}>
              <strong>{m.value}</strong>
              <span>{m.label}</span>
            </div>
          ))}
        </div>
      )}
      {actions && <div className="sq-v2-btnrow">{actions}</div>}
    </section>
  );
}

export function QuickAction({ icon: Icon, label, onClick, href, main }: { icon: LucideIcon; label: string; onClick?: () => void; href?: string; main?: boolean }) {
  const inner = (
    <>
      <i>
        <Icon size={18} />
      </i>
      {label}
    </>
  );
  return href ? (
    <Link href={href} className="sq-v2-qa" data-main={main}>
      {inner}
    </Link>
  ) : (
    <button type="button" className="sq-v2-qa" data-main={main} onClick={onClick}>
      {inner}
    </button>
  );
}

/** Primary mobile action, floated above the bottom navigation. */
export function FAB({ label, icon: Icon = Plus, onClick, href }: { label: string; icon?: LucideIcon; onClick?: () => void; href?: string }) {
  const inner = (
    <>
      <Icon size={20} /> {label}
    </>
  );
  return href ? (
    <Link href={href} className="sq-v2-fab">
      {inner}
    </Link>
  ) : (
    <button type="button" className="sq-v2-fab" onClick={onClick}>
      {inner}
    </button>
  );
}

export type TabItem = { id: string; label: string };
export function Tabs({ items, value, onChange, label }: { items: TabItem[]; value: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + items.length) % items.length;
    refs.current[next]?.focus();
    onChange(items[next].id);
  }
  return (
    <div className="sq-v2-tabs" role="tablist" aria-label={label}>
      {items.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="tab"
          aria-selected={t.id === value}
          tabIndex={t.id === value ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Chips({ items, value, onChange, label }: { items: TabItem[]; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <div className="sq-v2-chips" role="group" aria-label={label}>
      {items.map((c) => (
        <button key={c.id} type="button" className="sq-v2-chip" aria-pressed={c.id === value} onClick={() => onChange(c.id)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" className="sq-v2-toggle" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="sq-v2-state">
      <Icon size={28} aria-hidden="true" />
      <h3>{title}</h3>
      {text && <p>{text}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ title = "Something went wrong", text = "Please check your connection and try again.", onRetry }: { title?: string; text?: string; onRetry?: () => void }) {
  return (
    <div className="sq-v2-state" data-tone="error" role="alert">
      <AlertTriangle size={28} aria-hidden="true" />
      <h3>{title}</h3>
      <p>{text}</p>
      {onRetry && (
        <Btn kind="outline" onClick={onRetry}>
          Try again
        </Btn>
      )}
    </div>
  );
}

export function Skeleton({ lines = 1, style }: { lines?: number; style?: CSSProperties }) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gap: 10, ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="sq-v2-skel" style={{ width: i === lines - 1 && lines > 1 ? "60%" : "100%" }} />
      ))}
    </div>
  );
}
