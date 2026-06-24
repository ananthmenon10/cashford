"use client";

import Link from "next/link";
import { useActionState } from "react";
import { submitCode, type CodeState } from "./actions";

const initial: CodeState = { error: null };

export default function JoinPage() {
  const [state, formAction, pending] = useActionState(submitCode, initial);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-7">
      <div className="w-full max-w-[360px]">
        <div className="mb-6">
          <Link
            href="/"
            className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-muted"
          >
            ← Back
          </Link>
          <div className="text-2xl font-extrabold tracking-tight">Join a league</div>
          <div className="mt-1 text-sm text-muted">Enter the 8-character code from your captain.</div>
        </div>

        <form action={formAction} className="flex flex-col">
          <label className="mb-1.5 text-xs font-semibold text-label" htmlFor="code">
            Invite code
          </label>
          <input
            id="code"
            name="code"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            maxLength={8}
            placeholder="e.g. A1B2C3D4"
            className={`mb-1 w-full rounded-control border bg-surface px-3.5 py-3 text-center font-mono text-[22px] font-bold tracking-[0.15em] uppercase outline-none focus:shadow-[0_0_0_3px_rgba(21,166,106,.12)] placeholder:text-muted placeholder:text-[15px] placeholder:tracking-normal placeholder:font-normal ${
              state.error ? "border-loss" : "border-border focus:border-primary"
            }`}
          />

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
            {pending ? "Looking up…" : "Find league"}
          </button>
        </form>
      </div>
    </main>
  );
}
