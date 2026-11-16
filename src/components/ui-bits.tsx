"use client";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { EmptyState } from "./v2/primitives";

export function Garden() {
  return (
    <div
      className="garden"
      aria-label="Illustration of a growing plant on study books"
      role="img"
    >
      <div className="orbit orbit-one" />
      <div className="orbit orbit-two" />
      <span className="garden-spark s1">✧</span>
      <span className="garden-spark s2">✦</span>
      <span className="garden-spark s3">✧</span>
      <div className="floating-tag">
        <span>✦</span> +10 XP <small>A little growth!</small>
      </div>
      <div className="plant">
        <div className="stem" />
        <i className="leaf l1" />
        <i className="leaf l2" />
        <i className="leaf l3" />
        <i className="leaf l4" />
        <div className="pot">
          <span>✳</span>
        </div>
      </div>
      <div className="book book-one" />
      <div className="book book-two" />
      <div className="garden-shadow" />
    </div>
  );
}

export function Empty({
  icon: Icon,
  title,
  text,
  action,
  v2,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  /** Optional call to action. */
  action?: ReactNode;
  /** Render with the redesigned empty-state look. */
  v2?: boolean;
}) {
  if (v2) return <EmptyState icon={Icon} title={title} text={text} action={action} />;
  return (
    <div className="empty">
      <span className="icon-tile mint">
        <Icon />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
