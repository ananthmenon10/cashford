"use client";

import { useActionState, useState } from "react";
import { changePassword } from "./actions";
import type { AuthState } from "../login/actions";

const initial: AuthState = { error: null };

// Cheap strength estimate (length + variety), 0–4 bars.
function strength(pw: string): { bars: number; label: string; ok: boolean } {
  const longEnough = pw.length >= 10;
  const hasNum = /\d/.test(pw);
  const hasSym = /[^A-Za-z0-9]/.test(pw);
  let score = 0;
  if (longEnough) score++;
  if (pw.length >= 14) score++;
  if (hasNum) score++;
  if (hasSym) score++;
  const ok = longEnough;
  let label = "";
  if (pw) {
    if (!longEnough) label = "Too short — use at least 10 characters";
    else if (hasNum && hasSym) label = "Strong password";
    else label = "Good — add a number or symbol to strengthen it";
  }
  return { bars: Math.min(score, 4), label, ok };
}

export default function ChangePasswordPage() {
  const [state, formAction, pending] = useActionState(changePassword, initial);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const s = strength(pw);
  const match = confirm.length > 0 && pw === confirm;

  return (
    <main className="min-h-screen bg-bg">
      <div className="mx-auto max-w-[420px]">
        <div className="border-b border-border bg-surface px-6 py-5">
          <h1 className="text-xl font-extrabold tracking-[-.01em]">Set your password</h1>
        </div>

        <form action={formAction} className="px-6 py-5">
          <div className="mb-[18px] flex items-start gap-2.5 rounded-control bg-amber-bg px-3.5 py-3">
            <span className="text-sm">🔒</span>
            <span className="text-[13px] font-semibold leading-snug text-amber-fg">
              For security, choose a new password before you start predicting.
            </span>
          </div>

          <label className="mb-1.5 block text-xs font-semibold text-label">New password</label>
          <div
            className={`flex items-center rounded-control border bg-surface px-3.5 ${
              pw && !s.ok ? "border-loss" : "border-primary shadow-[0_0_0_3px_rgba(21,166,106,.12)]"
            }`}
          >
            <input
              name="password"
              type={show ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="new-password"
              className="flex-1 border-none bg-transparent py-3 text-[15px] outline-none"
            />
            <button type="button" onClick={() => setShow((v) => !v)} className="text-xs font-bold text-primary-press">
              {show ? "Hide" : "Show"}
            </button>
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`h-1 flex-1 rounded-sm ${i < s.bars ? "bg-win" : "bg-border"}`}
              />
            ))}
          </div>
          {s.label && (
            <div className={`mt-1.5 text-[11px] font-semibold ${s.ok ? "text-win" : "text-muted"}`}>{s.label}</div>
          )}

          <label className="mb-1.5 mt-4 block text-xs font-semibold text-label">Confirm password</label>
          <div className="flex items-center rounded-control border border-border bg-surface px-3.5">
            <input
              name="confirm"
              type={show ? "text" : "password"}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              className="flex-1 border-none bg-transparent py-3 text-[15px] outline-none"
            />
            {match && (
              <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-win text-[11px] font-extrabold text-white">
                ✓
              </span>
            )}
          </div>

          {state.error && (
            <div className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-loss">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-loss text-[10px] font-extrabold text-white">
                !
              </span>
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending || !s.ok || !match}
            className="mt-[22px] w-full rounded-control bg-primary py-3.5 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save & continue"}
          </button>
        </form>
      </div>
    </main>
  );
}
