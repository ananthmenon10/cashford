"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState, useState } from "react";
import { signUp, type AuthState } from "./actions";

const initial: AuthState = { error: null };

export default function SignUpPage() {
  const [state, formAction, pending] = useActionState(signUp, initial);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
      <div className="w-full max-w-[360px]">
        {/* Brand */}
        <div className="mb-7 flex flex-col items-center">
          <Image
            src="/icon-512.png"
            alt="Cashford"
            width={64}
            height={64}
            priority
            className="mb-[18px] rounded-[18px] shadow-[0_8px_22px_rgba(21,166,106,.4)]"
          />
          <div className="text-[26px] font-extrabold tracking-[-.025em]">Cashford</div>
          <div className="mt-1.5 text-sm text-muted">Predict. Settle. Brag.</div>
        </div>

        <form action={formAction} className="flex flex-col">
          {/* Username */}
          <label className="mb-1.5 text-xs font-semibold text-label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            name="username"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            className="mb-1 w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgba(21,166,106,.12)]"
          />
          <p className="mb-3.5 text-[11px] text-muted">
            Letters, numbers, _ or - · 3–20 chars
          </p>

          {/* Display name */}
          <label className="mb-1.5 text-xs font-semibold text-label" htmlFor="displayName">
            Display name
          </label>
          <input
            id="displayName"
            name="displayName"
            autoComplete="name"
            placeholder="Leave blank to use your username"
            className="mb-3.5 w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgba(21,166,106,.12)] placeholder:text-muted"
          />

          {/* Password */}
          <label className="mb-1.5 text-xs font-semibold text-label" htmlFor="password">
            Password
          </label>
          <div className="mb-3.5 flex items-center rounded-control border border-border bg-surface px-3.5 focus-within:border-primary">
            <input
              id="password"
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              className="flex-1 border-none bg-transparent py-3 text-[15px] outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              className="text-xs font-bold text-primary-press"
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>

          {/* Confirm password */}
          <label className="mb-1.5 text-xs font-semibold text-label" htmlFor="confirm">
            Confirm password
          </label>
          <div
            className={`flex items-center rounded-control border bg-surface px-3.5 ${
              state.error ? "border-loss" : "border-border focus-within:border-primary"
            }`}
          >
            <input
              id="confirm"
              name="confirm"
              type={showConfirm ? "text" : "password"}
              autoComplete="new-password"
              className="flex-1 border-none bg-transparent py-3 text-[15px] outline-none"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((s) => !s)}
              className="text-xs font-bold text-primary-press"
            >
              {showConfirm ? "Hide" : "Show"}
            </button>
          </div>

          {state.error && (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-loss">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-loss text-[10px] font-extrabold text-white">
                !
              </span>
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-[18px] w-full rounded-control bg-primary py-3.5 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)] disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs leading-relaxed text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-primary-press">
            Log in
          </Link>
        </p>
      </div>
    </main>
  );
}
