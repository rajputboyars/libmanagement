"use client";
import type { LucideIcon } from "lucide-react";

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
}: {
  icon: LucideIcon;
  title: string;
  text: string;
}) {
  return (
    <div className="empty">
      <span className="icon-tile mint">
        <Icon />
      </span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
