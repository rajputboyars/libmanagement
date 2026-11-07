"use client";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { useLayoutMode } from "./layout";
import { Btn } from "./primitives";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Full-screen on every layout (used by the mobile More screen). */
  full?: boolean;
};

/** Centered dialog on tablet/desktop, bottom sheet on mobile. Built on <dialog> for focus trap, Esc and inert background. */
export function ResponsiveDialog({ open, onClose, title, description, children, footer, size = "md", full = false }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const mode = useLayoutMode();
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
    document.documentElement.classList.toggle("sq-v2-lock-scroll", open);
    return () => document.documentElement.classList.remove("sq-v2-lock-scroll");
  }, [open]);
  const sheet = mode === "mobile" && !full;
  return (
    <dialog
      ref={ref}
      className="sq-v2-dialog"
      data-size={size}
      data-sheet={sheet}
      data-full={full}
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <>
          {sheet && <div className="sq-v2-grab" aria-hidden="true" />}
          <div className="sq-v2-dhead">
            <div>
              <h2 id={id}>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            <button type="button" className="sq-v2-iconbtn" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>
          <div className="sq-v2-dbody">{children}</div>
          {footer && (
            <div className="sq-v2-dfoot" data-stack={sheet}>
              {footer}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
}) {
  return (
    <ResponsiveDialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Btn kind="outline" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Btn>
          <Btn kind={danger ? "danger" : "primary"} onClick={onConfirm} disabled={busy}>
            {busy ? "Please wait…" : confirmLabel}
          </Btn>
        </>
      }
    >
      <div style={{ fontSize: 14, color: "var(--sq-body)" }}>{message}</div>
    </ResponsiveDialog>
  );
}
