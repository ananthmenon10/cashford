"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";
import { CompetitionPicker } from "@/components/gw/CompetitionPicker";
import {
  C35,
  GW_CREATE_COPY,
  GW_UI_COPY,
  createLiveCopy,
  shareInviteCopy,
} from "@/lib/gw-copy";
import { createConsequenceCopy, firstDeadlinePrefix } from "@/lib/payment-copy";
import { LocalTime } from "@/components/LocalTime";
import { slugify, validateSlug, validateStake } from "@/lib/validation";
import {
  checkSlug,
  createLeague,
  listCreatableCompetitions,
  type CreatableCompetition,
  type CreateState,
} from "./actions";

const STAKE_CHIPS = [50, 100, 500, 1000];
const INITIAL: CreateState = { error: null };

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export default function NewLeaguePage() {
  const [state, formAction, pending] = useActionState(createLeague, INITIAL);
  const [name, setName] = useState("");
  const [stake, setStake] = useState("500");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [competitions, setCompetitions] = useState<CreatableCompetition[] | null>(
    null,
  );
  const [competition, setCompetition] = useState("");
  const [competitionError, setCompetitionError] = useState(false);
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "available" | "taken" | "invalid"
  >("idle");
  const [slugError, setSlugError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"link" | "code" | null>(null);
  const debouncedSlug = useDebounce(slug, 400);
  const stakeResult = validateStake(stake);

  useEffect(() => {
    let active = true;
    listCreatableCompetitions()
      .then((list) => {
        if (!active) return;
        setCompetitions(list);
        setCompetition(list[0]?.slug ?? "");
      })
      .catch(() => {
        if (!active) return;
        setCompetitions([]);
        setCompetitionError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!slugEdited) setSlug(slugify(name));
  }, [name, slugEdited]);

  useEffect(() => {
    if (!slug) {
      setSlugStatus("idle");
      setSlugError(null);
      return;
    }
    const local = validateSlug(slug);
    if (!local.ok) {
      setSlugStatus("invalid");
      setSlugError(local.error);
      return;
    }
    setSlugStatus("checking");
    setSlugError(null);
  }, [slug]);

  useEffect(() => {
    if (!debouncedSlug || !validateSlug(debouncedSlug).ok) return;
    let active = true;
    checkSlug(debouncedSlug)
      .then((result) => {
        if (!active) return;
        if (result.error) {
          setSlugStatus("invalid");
          setSlugError(result.error);
        } else if (result.available) {
          setSlugStatus("available");
          setSlugError(null);
        } else {
          setSlugStatus("taken");
          setSlugError(GW_CREATE_COPY.taken);
        }
      })
      .catch(() => {
        if (!active) return;
        setSlugStatus("invalid");
        setSlugError(GW_CREATE_COPY.taken);
      });
    return () => {
      active = false;
    };
  }, [debouncedSlug]);

  function copyText(value: string, kind: "link" | "code") {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    });
  }

  if (state.created) {
    const league = state.created;
    const origin =
      typeof window === "undefined"
        ? "https://cashford.vercel.app"
        : window.location.origin;
    const inviteLink = `${origin}/leagues/join?token=${encodeURIComponent(league.token)}`;
    const whatsAppText = encodeURIComponent(
      shareInviteCopy(league.name, inviteLink, league.shortCode),
    );
    return (
      <main className="flex min-h-screen items-center justify-center bg-cs2-canvas px-5 py-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-extrabold">{createLiveCopy(league.name)}</h1>
            <p className="mt-1 text-sm text-cs2-ink-3">{GW_CREATE_COPY.shareBody}</p>
          </div>

          <div className="mb-3 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-cs2-ink-3">
              {GW_CREATE_COPY.inviteLink}
            </p>
            <p className="my-3 break-all font-mono text-[13px]">{inviteLink}</p>
            <button
              type="button"
              onClick={() => copyText(inviteLink, "link")}
              className="w-full rounded-cs2-md bg-cs2-green py-2.5 text-[14px] font-bold text-white"
            >
              {copied === "link" ? GW_CREATE_COPY.copied : GW_CREATE_COPY.copyLink}
            </button>
          </div>

          <div className="mb-3 rounded-cs2-lg border border-cs2-line bg-cs2-paper p-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-cs2-ink-3">
              {GW_CREATE_COPY.shortCode}
            </p>
            <p className="my-3 font-mono text-2xl font-bold tracking-[0.15em]">
              {league.shortCode}
            </p>
            <button
              type="button"
              onClick={() => copyText(league.shortCode, "code")}
              className="w-full rounded-cs2-md border border-cs2-line bg-cs2-paper-2 py-2.5 text-[14px] font-semibold"
            >
              {copied === "code" ? GW_CREATE_COPY.copied : GW_CREATE_COPY.copyCode}
            </button>
          </div>

          <a
            href={`https://wa.me/?text=${whatsAppText}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mb-3 flex w-full items-center justify-center rounded-cs2-md bg-[#25D366] py-3 text-[14px] font-bold text-white"
          >
            {GW_CREATE_COPY.shareWhatsApp}
          </a>
          <Link
            href={`/leagues/${league.slug}`}
            className="flex w-full items-center justify-center rounded-cs2-md border border-cs2-line bg-cs2-paper py-3 text-[14px] font-bold text-cs2-green"
          >
            {GW_CREATE_COPY.openLeague}
          </Link>
        </div>
      </main>
    );
  }

  const blocked =
    competitions !== null && competitions.length === 0;
  return (
    <main className="flex min-h-screen items-center justify-center bg-cs2-canvas px-5 py-8">
      <div className="w-full max-w-[400px]">
        <Link
          href="/"
          className="mb-5 inline-flex text-sm font-semibold text-cs2-ink-3"
        >
          ← {GW_UI_COPY.back}
        </Link>
        <h1 className="text-2xl font-extrabold">{GW_CREATE_COPY.title}</h1>
        <p className="mb-6 mt-1 text-sm text-cs2-ink-3">
          {GW_CREATE_COPY.subtitle}
        </p>

        <form action={formAction} className="flex flex-col gap-4">
          <CompetitionPicker
            competitions={competitions}
            value={competition}
            onChange={setCompetition}
            unavailable={competitionError}
          />
          {competitions?.find((item) => item.slug === competition) ? <div className="-mt-2 rounded-cs2-md bg-cs2-paper-2 p-3 text-[12px] text-cs2-ink-2"><p className="font-bold">{competitions.find((item) => item.slug === competition)?.name}</p><p className="mt-1">{createConsequenceCopy(stakeResult.ok ? stakeResult.value : 0)}</p>{competitions.find((item) => item.slug === competition)?.nextGameweekNumber && competitions.find((item) => item.slug === competition)?.nextDeadlineAt ? <p className="mt-1">{firstDeadlinePrefix(competitions.find((item) => item.slug === competition)!.nextGameweekNumber!)}{" "}<LocalTime iso={competitions.find((item) => item.slug === competition)!.nextDeadlineAt!} relative={false} /></p> : null}</div> : null}

          <label className="text-xs font-semibold text-cs2-ink-2">
            {GW_UI_COPY.leagueName}
            <input
              name="name"
              required
              maxLength={60}
              autoComplete="off"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={GW_CREATE_COPY.namePlaceholder}
              className="mt-1.5 w-full rounded-cs2-md border border-cs2-line bg-cs2-paper px-3.5 py-3 text-[15px] outline-none focus:border-cs2-green"
            />
          </label>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-cs2-ink-2" htmlFor="stake">
              {C35}
            </label>
            <div className="mb-2 flex gap-2">
              {STAKE_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => setStake(String(chip))}
                  className={`flex-1 rounded-cs2-pill border py-1.5 text-[13px] font-semibold ${
                    stake === String(chip)
                      ? "border-cs2-green bg-cs2-mint text-cs2-green"
                      : "border-cs2-line bg-cs2-paper"
                  }`}
                >
                  ₹{chip.toLocaleString("en-IN")}
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
              onChange={(event) => setStake(event.target.value)}
              aria-invalid={!stakeResult.ok}
              className="w-full rounded-cs2-md border border-cs2-line bg-cs2-paper px-3.5 py-3 text-[15px] outline-none focus:border-cs2-green"
            />
            <p className={`mt-1.5 text-[11px] ${stakeResult.ok ? "text-cs2-ink-3" : "font-semibold text-cs2-red"}`}>
              {stakeResult.ok ? GW_CREATE_COPY.anteHelp : stakeResult.error}
            </p>
          </div>

          <label className="text-xs font-semibold text-cs2-ink-2">
            {GW_CREATE_COPY.inviteUrl}
            <input
              name="slug"
              required
              autoCapitalize="none"
              autoCorrect="off"
              value={slug}
              onChange={(event) => {
                setSlug(event.target.value);
                setSlugEdited(true);
              }}
              placeholder={GW_CREATE_COPY.slugPlaceholder}
              className="mt-1.5 w-full rounded-cs2-md border border-cs2-line bg-cs2-paper px-3.5 py-3 font-mono text-[15px] outline-none focus:border-cs2-green"
            />
          </label>
          <p className={`text-[11px] ${slugError ? "font-semibold text-cs2-red" : "text-cs2-ink-3"}`}>
            {slugError ??
              (slugStatus === "checking"
                ? GW_CREATE_COPY.checking
                : slugStatus === "available"
                  ? GW_CREATE_COPY.available
                  : null)}
          </p>

          {state.error ? (
            <p className="text-xs font-semibold text-cs2-red">{state.error}</p>
          ) : null}
          <button
            type="submit"
            disabled={
              pending ||
              blocked ||
              !competition ||
              !stakeResult.ok ||
              slugStatus !== "available"
            }
            className="w-full rounded-cs2-md bg-cs2-green py-3.5 text-[15px] font-bold text-white disabled:opacity-50"
          >
            {pending ? GW_CREATE_COPY.creating : GW_CREATE_COPY.create}
          </button>
        </form>
      </div>
    </main>
  );
}
