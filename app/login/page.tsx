"use client";

import { useActionState, useState } from "react";
import { login, type AuthState } from "./actions";

const initial: AuthState = { error: null };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, initial);
  const [show, setShow] = useState(false);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
      <div className="w-full max-w-[360px]">
        {/* Brand */}
        <div className="mb-7 flex flex-col items-center">
          <div className="mb-[18px] flex h-[60px] w-[60px] items-center justify-center rounded-[20px] bg-primary shadow-[0_8px_22px_rgba(21,166,106,.4)]">
            <div className="h-6 w-6 rounded-full bg-accent" />
          </div>
          <div className="text-[26px] font-extrabold tracking-[-.025em]">Cashford</div>
          <div className="mt-1.5 text-sm text-muted">Predict. Settle. Brag.</div>
        </div>

        <form action={formAction} className="flex flex-col">
          <label className="mb-1.5 text-xs font-semibold text-label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            name="username"
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="username"
            className="mb-3.5 w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgba(21,166,106,.12)]"
          />

          <label className="mb-1.5 text-xs font-semibold text-label" htmlFor="password">
            Password
          </label>
          <div
            className={`flex items-center rounded-control border bg-surface px-3.5 ${
              state.error ? "border-loss" : "border-border focus-within:border-primary"
            }`}
          >
            <input
              id="password"
              name="password"
              type={show ? "text" : "password"}
              autoComplete="current-password"
              className="flex-1 border-none bg-transparent py-3 text-[15px] outline-none"
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="text-xs font-bold text-primary-press"
            >
              {show ? "Hide" : "Show"}
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
            {pending ? "Logging in…" : "Log in"}
          </button>
        </form>

        <p className="mt-4 text-center text-xs leading-relaxed text-muted">
          First time? Your captain set a temp password —<br />
          you&apos;ll choose your own next.
        </p>
      </div>
    </main>
  );
}
