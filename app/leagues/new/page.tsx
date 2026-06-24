"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState } from "react";
import { createLeague, checkSlug, type CreateState } from "./actions";
import { slugify, validateSlug, validateStake } from "@/lib/validation";

const STAKE_CHIPS = [50, 100, 500, 1000];
const INITIAL: CreateState = { error: null };

// Debounce helper
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function NewLeaguePage() {
  const [state, formAction, pending] = useActionState(createLeague, INITIAL);

  const [name, setName] = useState("");
  const [stake, setStake] = useState("500");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);

  // Slug availability
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [slugError, setSlugError] = useState<string | null>(null);

  // Client-side stake validity (instant, styled — no native browser popup)
  const [stakeError, setStakeError] = useState<string | null>(null);

  // Copy feedback
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const debouncedSlug = useDebounce(slug, 400);

  // Auto-derive slug from name unless the user has manually edited it
  useEffect(() => {
    if (!slugEdited) {
      setSlug(slugify(name));
    }
  }, [name, slugEdited]);

  // Instant client-side validity on every keystroke — kills the stale-"Available"
  // flash while the debounced server check is pending, and surfaces reserved/format
  // errors immediately without a round-trip.
  useEffect(() => {
    if (!slug) {
      setSlugStatus("idle");
      setSlugError(null);
      return;
    }
    const v = validateSlug(slug);
    if (!v.ok) {
      setSlugStatus("invalid");
      setSlugError(v.error);
    } else {
      setSlugStatus("checking");
      setSlugError(null);
    }
  }, [slug]);

  // Debounced server availability check — only for client-valid slugs.
  useEffect(() => {
    if (!debouncedSlug || !validateSlug(debouncedSlug).ok) return;
    let cancelled = false;
    checkSlug(debouncedSlug).then((res) => {
      if (cancelled) return;
      if (res.error) {
        setSlugStatus("invalid");
        setSlugError(res.error);
      } else if (res.available) {
        setSlugStatus("available");
        setSlugError(null);
      } else {
        setSlugStatus("taken");
        setSlugError("That URL is already taken.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedSlug]);

  // Instant stake validity — styled inline error instead of the native browser popup.
  useEffect(() => {
    if (stake === "") {
      setStakeError(null);
      return;
    }
    const v = validateStake(stake);
    setStakeError(v.ok ? null : v.error);
  }, [stake]);

  // ── Share panel (post-success) ──────────────────────────────────────────
  if (state.created) {
    const { name: lgName, token, shortCode, slug: lgSlug } = state.created;
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://cashford.app";
    const inviteLink = `${origin}/j/${token}`;
    const waText = encodeURIComponent(
      `Join my World Cup 2026 league "${lgName}" on Cashford!\n${inviteLink}\n\nOr enter code: ${shortCode}`,
    );

    const copyText = (text: string, cb: (v: boolean) => void) => {
      navigator.clipboard.writeText(text).then(() => {
        cb(true);
        setTimeout(() => cb(false), 2000);
      });
    };

    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-5">
        <div className="w-full max-w-[400px]">
          {/* Success heading */}
          <div className="mb-6 text-center">
            <div className="mb-2 text-4xl">🏆</div>
            <div className="text-2xl font-extrabold tracking-tight">{lgName} is live</div>
            <div className="mt-1 text-sm text-muted">Share the link with your group</div>
          </div>

          {/* Invite link */}
          <div className="mb-4 rounded-card border border-border bg-surface p-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Invite link
            </div>
            <div className="mb-3 break-all font-mono text-[13px] text-fg">{inviteLink}</div>
            <button
              onClick={() => copyText(inviteLink, setCopiedLink)}
              className="w-full rounded-control bg-primary py-2.5 text-[14px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)]"
            >
              {copiedLink ? "Copied!" : "Copy link"}
            </button>
          </div>

          {/* Short code */}
          <div className="mb-4 rounded-card border border-border bg-surface p-4">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
              Short code (manual entry)
            </div>
            <div className="mb-3 font-mono text-2xl font-bold tracking-[0.15em]">
              {shortCode}
            </div>
            <button
              onClick={() => copyText(shortCode, setCopiedCode)}
              className="w-full rounded-control border border-border bg-subtle py-2.5 text-[14px] font-semibold text-fg"
            >
              {copiedCode ? "Copied!" : "Copy code"}
            </button>
          </div>

          {/* WhatsApp */}
          <a
            href={`https://wa.me/?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-4 flex w-full items-center justify-center gap-2 rounded-control border border-[#25D366] bg-[#25D366] py-2.5 text-[14px] font-bold text-white"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
            Share on WhatsApp
          </a>

          {/* Open league */}
          <Link
            href={`/leagues/${lgSlug}`}
            className="flex w-full items-center justify-center gap-1 rounded-control border border-border bg-surface py-3 text-[14px] font-bold text-primary-press"
          >
            Open league →
          </Link>

          <p className="mt-3 text-center text-[11px] text-muted">
            The invite link will be active once Phase 3 is deployed.
          </p>
        </div>
      </main>
    );
  }

  // ── Creation form ───────────────────────────────────────────────────────
  const slugIndicator =
    slugStatus === "checking" ? (
      <span className="text-muted">Checking…</span>
    ) : slugStatus === "available" ? (
      <span className="text-win font-semibold">✓ Available</span>
    ) : slugStatus === "taken" || slugStatus === "invalid" ? (
      <span className="text-loss font-semibold">✗ {slugError}</span>
    ) : null;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-bg px-5">
      <div className="w-full max-w-[400px]">
        {/* Header */}
        <div className="mb-6">
          <Link
            href="/"
            className="mb-5 inline-flex items-center gap-1 text-sm font-semibold text-muted"
          >
            ← Back
          </Link>
          <div className="text-2xl font-extrabold tracking-tight">Create a league</div>
          <div className="mt-1 text-sm text-muted">
            Set up your World Cup 2026 group in seconds.
          </div>
        </div>

        <form action={formAction} className="flex flex-col gap-4">
          {/* League name */}
          <div>
            <label
              className="mb-1.5 block text-xs font-semibold text-label"
              htmlFor="name"
            >
              League name
            </label>
            <input
              id="name"
              name="name"
              required
              maxLength={60}
              autoComplete="off"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Solid Yenne Boys"
              className="w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px] outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgba(21,166,106,.12)] placeholder:text-muted"
            />
          </div>

          {/* Stake per match */}
          <div>
            <label
              className="mb-1.5 block text-xs font-semibold text-label"
              htmlFor="stake"
            >
              Stake per match (₹)
            </label>
            {/* Quick-pick chips */}
            <div className="mb-2 flex gap-2">
              {STAKE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setStake(String(chip))}
                  className={`flex-1 rounded-pill border py-1.5 text-[13px] font-semibold transition-colors ${
                    stake === String(chip)
                      ? "border-primary bg-mint text-primary-press"
                      : "border-border bg-surface text-fg"
                  }`}
                >
                  ₹{chip >= 1000 ? chip / 1000 + "k" : chip}
                </button>
              ))}
            </div>
            <input
              id="stake"
              name="stake"
              type="number"
              step={1}
              inputMode="numeric"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              aria-invalid={stakeError ? true : undefined}
              className={`w-full rounded-control border bg-surface px-3.5 py-3 text-[15px] outline-none focus:shadow-[0_0_0_3px_rgba(21,166,106,.12)] ${
                stakeError ? "border-loss" : "border-border focus:border-primary"
              }`}
            />
            {stakeError ? (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-loss">
                <span className="flex h-3 w-3 shrink-0 items-center justify-center rounded-full bg-loss text-[8px] font-extrabold text-white">
                  !
                </span>
                {stakeError}
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                Min ₹50. Stakes are an honour-system tally settled outside the app — treat it as
                points if you don&apos;t play for money; it&apos;s just so the leaderboard works.
              </p>
            )}
          </div>

          {/* Slug / invite URL */}
          <div>
            <label
              className="mb-1.5 block text-xs font-semibold text-label"
              htmlFor="slug"
            >
              Invite URL
            </label>
            <input
              id="slug"
              name="slug"
              autoCapitalize="none"
              autoCorrect="off"
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value);
                setSlugEdited(true);
              }}
              placeholder="your-league-name"
              className="w-full rounded-control border border-border bg-surface px-3.5 py-3 text-[15px] font-mono outline-none focus:border-primary focus:shadow-[0_0_0_3px_rgba(21,166,106,.12)] placeholder:text-muted"
            />
            {/* Preview + availability */}
            <div className="mt-1.5 flex items-center justify-between">
              <span className="font-mono text-[11px] text-muted">
                cashford.app/l/
                <span className={slug ? "text-fg" : "text-muted"}>{slug || "…"}</span>
              </span>
              <span className="text-[11px]">{slugIndicator}</span>
            </div>
          </div>

          {/* Global error */}
          {state.error && (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-loss">
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-loss text-[10px] font-extrabold text-white">
                !
              </span>
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending || !!stakeError || slugStatus === "invalid" || slugStatus === "taken"}
            className="mt-1 w-full rounded-control bg-primary py-3.5 text-[15px] font-bold text-white shadow-[0_4px_12px_rgba(21,166,106,.3)] disabled:opacity-50"
          >
            {pending ? "Creating…" : "Create league"}
          </button>
        </form>
      </div>
    </main>
  );
}
