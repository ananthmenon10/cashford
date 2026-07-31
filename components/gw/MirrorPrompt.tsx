"use client";

import { useMemo, useState } from "react";
import {
  C51,
  C52,
  C53,
  C56,
  GW_UI_COPY,
  mirrorErrorCopy,
  mirrorTargetErrorCopy,
} from "@/lib/gw-copy";
import type { MirrorTarget } from "@/lib/gw-view";

export function MirrorPrompt({
  sourceLeagueId,
  gameweekId,
  targets,
  onDone,
  returnPath = "/",
}: {
  sourceLeagueId: string;
  gameweekId: string;
  targets: MirrorTarget[];
  onDone: () => void;
  returnPath?: string;
}) {
  const [selected, setSelected] = useState(() => new Set(targets.map((target) => target.leagueId)));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetErrors, setTargetErrors] = useState<string[]>([]);
  const [reloadRequired, setReloadRequired] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const chosen = useMemo(
    () => targets.filter((target) => selected.has(target.leagueId)),
    [selected, targets],
  );

  async function submit() {
    if (readOnly) return;
    if (!chosen.length) return onDone();
    setPending(true);
    setError(null);
    setTargetErrors([]);
    setReloadRequired(false);
    setSessionExpired(false);
    try {
      const response = await fetch("/api/gw/mirror", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fromLeagueId: sourceLeagueId,
          gameweekId,
          targets: chosen.map((target) => ({
            leagueId: target.leagueId,
            acceptedStakeInr: target.acceptedStakeInr,
          })),
        }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as {
          error?: string;
          targets?: { leagueId: string; error: string }[];
        };
        const mapped = mirrorErrorCopy(payload.error, response.status);
        setError(mapped.copy);
        setReloadRequired(mapped.reload);
        setSessionExpired(mapped.sessionExpired);
        setReadOnly(mapped.readOnly);
        if (Array.isArray(payload.targets)) {
          const targetMappings = payload.targets.map((target) => {
            const league = targets.find(
              (candidate) => candidate.leagueId === target.leagueId,
            );
            const leagueName = league?.leagueName ?? GW_UI_COPY.thatLeague;
            return mirrorTargetErrorCopy(target.error, leagueName);
          });
          setTargetErrors(targetMappings.map((target) => target.copy));
          setReloadRequired(
            mapped.reload || targetMappings.some((target) => target.reload),
          );
        }
        return;
      }
      onDone();
    } catch {
      setError(C56);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-cs2-lg border border-cs2-green-line bg-cs2-green-soft p-5">
      <h2 className="text-[17px] font-extrabold">{C51}</h2>
      <div className="mt-3 space-y-2">
        {targets.map((target) => (
          <label
            key={target.leagueId}
            className="flex items-center gap-3 rounded-cs2-md border border-cs2-green-line bg-cs2-paper px-3 py-2.5"
          >
            <input
              type="checkbox"
              disabled={pending || readOnly}
              checked={selected.has(target.leagueId)}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(target.leagueId);
                else next.delete(target.leagueId);
                setSelected(next);
              }}
            />
            <span className="text-[13px] font-bold">
              {C52(target.leagueName, target.acceptedStakeInr)}
            </span>
          </label>
        ))}
      </div>
      {error ? (
        <p className="mt-3 text-[12px] font-semibold text-cs2-red">
          {error}
        </p>
      ) : null}
      {targetErrors.length ? (
        <ul className="mt-3 space-y-1 text-[12px] font-semibold text-cs2-red">
          {targetErrors.map((targetError, index) => (
            <li key={`${index}:${targetError}`}>{targetError}</li>
          ))}
        </ul>
      ) : null}
      {reloadRequired ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 w-full rounded-cs2-md border border-cs2-green-line bg-cs2-paper py-3 text-[14px] font-bold text-cs2-green"
        >
          {GW_UI_COPY.reloadGameweek}
        </button>
      ) : null}
      {sessionExpired ? (
        <a
          href={`/login?next=${encodeURIComponent(returnPath)}`}
          className="mt-3 block w-full rounded-cs2-md border border-cs2-green-line bg-cs2-paper py-3 text-center text-[14px] font-bold text-cs2-green"
        >
          {GW_UI_COPY.signInAgain}
        </a>
      ) : null}
      <button
        type="button"
        disabled={pending || readOnly || !chosen.length}
        onClick={submit}
        className="mt-4 w-full rounded-cs2-md bg-cs2-green py-3 text-[14px] font-bold text-white disabled:opacity-40"
      >
        {pending ? GW_UI_COPY.saving : C53(chosen.length)}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onDone}
        className="mt-2 w-full rounded-cs2-md border border-cs2-green-line bg-cs2-paper py-3 text-[14px] font-bold text-cs2-green disabled:opacity-40"
      >
        {GW_UI_COPY.notNow}
      </button>
    </section>
  );
}
