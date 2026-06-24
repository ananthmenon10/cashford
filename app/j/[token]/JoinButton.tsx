"use client";

import { useActionState } from "react";

type Props = {
  action: (prev: { error: string | null }, fd: FormData) => Promise<{ error: string | null }>;
  stakeInr: number;
};

const initial = { error: null };

export function JoinButton({ action, stakeInr }: Props) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <form action={formAction}>
      {state.error && (
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-loss">
          <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-loss text-[10px] font-extrabold text-white">
            !
          </span>
          {state.error}
        </div>
      )}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-control bg-primary py-3.5 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)] disabled:opacity-50"
      >
        {pending ? "Joining…" : `Join — ₹${stakeInr}/match`}
      </button>
    </form>
  );
}
