"use client";
import { Garden } from "@/components/ui-bits";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowUpRight, ArrowRight, ChevronLeft, Leaf } from "lucide-react";

const authSchema = z.object({
  name: z.string().optional(),
  email: z.email("Enter a valid email"),
  password: z.string().min(10, "Use at least 10 characters"),
  role: z.enum(["student", "owner"]),
  library: z.string().optional(),
  referralCode: z.string().optional(),
});
export function Auth({ register }: { register: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [error, setError] = useState("");
  const {
    register: field,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof authSchema>>({
    resolver: zodResolver(authSchema),
    defaultValues: { role: "student" },
  });
  const role = useWatch({ control, name: "role" });
  return (
    <div className="auth-page">
      <div className="auth-art">
        <Link className="brand" href="/">
          <span className="brand-mark">✳</span>StudyQuest.
        </Link>
        <div>
          <span className="eyebrow">A SPACE FOR YOUR NEXT CHAPTER</span>
          <h1>
            Small steps.
            <br />
            Extraordinary
            <br />
            <em>possibilities.</em>
          </h1>
          <p>A calmer place to study. A smarter way to grow.</p>
          <Garden />
        </div>
        <span className="tiny">
          Built for better days, one focused moment at a time.
        </span>
      </div>
      <main className="auth-main">
        <Link href="/" className="text-link">
          <ChevronLeft size={16} />
          Back to home
        </Link>
        <div className="auth-form">
          <span className="icon-tile mint">
            <Leaf />
          </span>
          <h1>
            {register
              ? "Your next chapter starts here."
              : "Welcome back to your space."}
          </h1>
          <p className="muted">
            {register
              ? "Make a little room for something great."
              : "A little focus. A little growth. Let’s begin."}
          </p>
          <form
            onSubmit={handleSubmit(async (values) => {
              setError("");
              try {
                const res = await fetch(
                  `/api/auth/${register ? "register" : "login"}`,
                  {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(values),
                  },
                );
                const result = await res.json();
                if (!res.ok) throw new Error(result.error);
                await queryClient.invalidateQueries({
                  queryKey: ["workspace"],
                });
                router.push(
                  result.role === "super-admin"
                    ? "/super-admin"
                    : result.role === "owner" && register
                      ? "/owner/onboarding"
                      : result.role === "owner" || result.role === "staff"
                      ? "/owner"
                      : "/app",
                );
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              }
            })}
          >
            {register && (
              <>
                <label>
                  Your name
                  <input
                    required
                    autoComplete="name"
                    {...field("name")}
                    placeholder="Alex Morgan"
                  />
                </label>
                <label>
                  I’m here to
                  <select {...field("role")}>
                    <option value="student">Build my study habit</option>
                    <option value="owner">Manage my study library</option>
                  </select>
                </label>
                {role === "owner" && (
                  <label>
                    Library name
                    <input
                      required
                      {...field("library")}
                      placeholder="The Reading Room"
                    />
                  </label>
                )}
                {role === "owner" && (
                  <label>
                    Referral code (optional)
                    <input maxLength={20} {...field("referralCode")} placeholder="SQ1A2B3C4D" />
                  </label>
                )}
              </>
            )}
            <label>
              Email address
              <input
                type="email"
                autoComplete="email"
                {...field("email")}
                placeholder="you@example.com"
              />
              {errors.email && (
                <span className="field-error">{errors.email.message}</span>
              )}
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                {...field("password")}
                placeholder="At least 10 characters"
              />
              {errors.password && (
                <span className="field-error">{errors.password.message}</span>
              )}
            </label>
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            <button className="button" disabled={isSubmitting}>
              {isSubmitting
                ? "One moment…"
                : register
                  ? "Create my account"
                  : "Sign in"}
              <ArrowRight size={17} />
            </button>
            {!register && <p className="auth-switch"><Link href="/forgot-password">Forgot your password?</Link></p>}
          </form>
          <p className="auth-switch">
            {register ? "Already have a space?" : "New here?"}{" "}
            <Link href={register ? "/login" : "/register"}>
              {register ? "Sign in" : "Start your journey"}
            </Link>
          </p>
          <div className="auth-divider">or take a look around</div>
          <div className="demo-links">
            <Link href="/app">
              Student preview <ArrowUpRight size={14} />
            </Link>
            <Link href="/owner">
              Owner preview <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
