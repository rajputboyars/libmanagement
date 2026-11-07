"use client";
import { cloneElement, forwardRef, useId, type InputHTMLAttributes, type ReactElement, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

/** Label + control + hint/error wiring. Works with react-hook-form (`{...register("x")}` on the child). */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactElement<{ id?: string; "aria-invalid"?: boolean; "aria-describedby"?: string }> }) {
  const id = useId();
  const note = error || hint;
  return (
    <div className="sq-v2-field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, "aria-invalid": error ? true : undefined, "aria-describedby": note ? id + "-note" : undefined })}
      {note && (
        <small id={id + "-note"} data-error={!!error} role={error ? "alert" : undefined}>
          {note}
        </small>
      )}
    </div>
  );
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput({ className, ...p }, ref) {
  return <input ref={ref} className={`sq-v2-input${className ? " " + className : ""}`} {...p} />;
});
export const SelectInput = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function SelectInput({ className, ...p }, ref) {
  return <select ref={ref} className={`sq-v2-input${className ? " " + className : ""}`} {...p} />;
});
export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea({ className, ...p }, ref) {
  return <textarea ref={ref} className={`sq-v2-input${className ? " " + className : ""}`} {...p} />;
});
