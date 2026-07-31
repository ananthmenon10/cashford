"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { submitFeedback } from "@/app/feedback/actions";
import { FEEDBACK_COPY } from "@/lib/gw-copy";
import { createClient } from "@/lib/supabase/client";

export function BugReportButton() {
  const pathname = usePathname() ?? "/";
  const [ready, setReady] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let mounted = true;

    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!mounted) return;
      setSignedIn(Boolean(user));
      setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      const nextSignedIn = Boolean(session?.user);
      setSignedIn(nextSignedIn);
      if (!nextSignedIn) setOpen(false);
      setReady(true);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  if (!ready || !signedIn) return null;

  async function send() {
    if (pending || sent) return;
    setPending(true);
    setError(null);
    let result: Awaited<ReturnType<typeof submitFeedback>>;
    try {
      result = await submitFeedback({ message, pathname });
    } catch {
      setPending(false);
      setError(FEEDBACK_COPY.sendError);
      return;
    }
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSent(true);
    window.setTimeout(() => {
      setOpen(false);
      setSent(false);
      setMessage("");
    }, 1000);
  }

  return (
    <div className="fixed bottom-20 right-4 z-50">
      {open ? (
        <section
          aria-label={FEEDBACK_COPY.title}
          className="w-[min(360px,calc(100vw-2rem))] rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4 text-cs2-ink shadow-[0_10px_35px_rgba(15,23,42,.16)]"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-extrabold">{FEEDBACK_COPY.title}</h2>
              <p className="mt-1 text-[12px] font-medium text-cs2-ink-3">
                {FEEDBACK_COPY.hint}
              </p>
            </div>
            <button
              type="button"
              aria-label={FEEDBACK_COPY.close}
              onClick={() => setOpen(false)}
              className="text-xl leading-none text-cs2-ink-3"
            >
              ×
            </button>
          </div>
          {sent ? (
            <p className="mt-5 text-[14px] font-bold text-cs2-green" aria-live="polite">
              {FEEDBACK_COPY.sent}!
            </p>
          ) : (
            <>
              <textarea
                autoFocus
                value={message}
                maxLength={2000}
                onChange={(event) => setMessage(event.target.value)}
                placeholder={FEEDBACK_COPY.placeholder}
                className="mt-4 min-h-28 w-full resize-y rounded-cs2-md border border-cs2-line bg-cs2-canvas px-3 py-2.5 text-[13px] font-medium text-cs2-ink outline-none placeholder:text-cs2-ink-3 focus:border-cs2-green"
              />
              {error ? (
                <p className="mt-2 text-[12px] font-semibold text-cs2-red" aria-live="polite">
                  {error}
                </p>
              ) : null}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-cs2-md px-3 py-2 text-[13px] font-bold text-cs2-ink-2"
                >
                  {FEEDBACK_COPY.cancel}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={send}
                  className="rounded-cs2-md bg-cs2-green px-4 py-2 text-[13px] font-bold text-white disabled:opacity-60"
                >
                  {pending ? FEEDBACK_COPY.sending : FEEDBACK_COPY.send}
                </button>
              </div>
            </>
          )}
        </section>
      ) : (
        <button
          type="button"
          aria-label={FEEDBACK_COPY.title}
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
          className="cf-press flex h-10 items-center gap-1.5 rounded-full border border-cs2-line bg-cs2-paper px-3 text-[12px] font-bold text-cs2-ink-2 shadow-[0_4px_16px_rgba(15,23,42,.12)]"
        >
          <span aria-hidden>⚑</span>
          <span>{FEEDBACK_COPY.button}</span>
        </button>
      )}
    </div>
  );
}
